/**
 * Resi (resi.io) live status, read-only.
 *
 * Uses Resi's public API (https://api.resi.io/v1) with an API client from Resi Studio (Client ID and
 * Client Secret, OAuth client credentials): the encoders, and the live schedules with each
 * destination's state (IDLE, SET_UP, STARTING, STARTED, STOPPING, STOPPED, ABORTED, ERROR). An
 * encoder counts as live while any of its destinations is starting or started (or, if Resi doesn't
 * list schedules for the account, while the encoder itself reports that it's streaming).
 *
 * Polled every 10 seconds while it's set up; the Dashboard widget and the Services badge read the
 * result. Sundays never starts or stops anything in Resi.
 */
import type { ResiSettingsView, ResiStatus, ResiEncoder } from "../../../shared/types.js";
import { decrypt, encrypt } from "./crypto.js";
import { extras, logEvent } from "./db.js";

const API = process.env.COOL_RESI_API || "https://api.resi.io/v1";

interface Stored { enabled: boolean; clientId: string; secretEnc: string | null; encoderIds: string[] }
const DEFAULTS: Stored = { enabled: false, clientId: "", secretEnc: null, encoderIds: [] };
const stored = (): Stored => ({ ...DEFAULTS, ...extras.get<Partial<Stored>>("resi", {}) });

export function resiSettings(): ResiSettingsView {
  const s = stored();
  return { enabled: s.enabled, clientId: s.clientId, hasSecret: Boolean(s.secretEnc), encoderIds: s.encoderIds };
}

export function saveResiSettings(p: { enabled?: boolean; clientId?: string; clientSecret?: string; encoderIds?: string[] }) {
  const s = stored();
  const next: Stored = {
    enabled: p.enabled ?? s.enabled,
    clientId: p.clientId?.trim() ?? s.clientId,
    secretEnc: p.clientSecret ? encrypt(p.clientSecret.trim()) : s.secretEnc,
    encoderIds: p.encoderIds ?? s.encoderIds,
  };
  const credsChanged = next.clientId !== s.clientId || Boolean(p.clientSecret);
  extras.set("resi", next);
  if (credsChanged) { token = null; schedulesUnsupportedUntil = 0; }
  startResi();
  return resiSettings();
}

/* ───────────── API ───────────── */

let token: { value: string; until: number } | null = null;

class ResiError extends Error { constructor(message: string, public status = 0) { super(message); } }

async function getToken(): Promise<string> {
  if (token && token.until > Date.now() + 30_000) return token.value;
  const s = stored();
  if (!s.clientId || !s.secretEnc) throw new ResiError("Add your Resi API Client ID and Secret.");
  const r = await fetch(`${API}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: s.clientId, client_secret: decrypt(s.secretEnc), grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new ResiError(r.status === 400 || r.status === 401 ? "Resi didn’t accept the Client ID and Secret." : `Resi sign-in failed (HTTP ${r.status}).`, r.status);
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new ResiError("Resi didn’t send an access token.");
  token = { value: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return token.value;
}

async function get<T>(path: string): Promise<{ status: number; body: T | null }> {
  const t = await getToken();
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${t}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (r.status === 401) token = null;
  if (r.status === 429) throw new ResiError("Resi is limiting requests right now.", 429);
  if (!r.ok) return { status: r.status, body: null };
  return { status: r.status, body: (await r.json().catch(() => null)) as T | null };
}

/** Arrays come back bare or wrapped ({ items }, { data }, { results }). */
const list = (v: unknown): Record<string, unknown>[] => {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === "object") for (const k of ["items", "data", "results", "schedules", "encoders"]) {
    const x = (v as Record<string, unknown>)[k];
    if (Array.isArray(x)) return x as Record<string, unknown>[];
  }
  return [];
};
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);

const LIVE_STATES = new Set(["STARTING", "STARTED", "LIVE", "RUNNING", "STREAMING", "BROADCASTING", "ON_AIR"]);
const isLiveWord = (v: unknown) => typeof v === "string" && LIVE_STATES.has(v.toUpperCase().replace(/[\s-]/g, "_"));
/** An encoder that says it's streaming (used when Resi doesn't list schedules). */
function encoderSaysLive(e: Record<string, unknown>): boolean {
  for (const k of ["isLive", "live", "streaming", "isStreaming"]) if (e[k] === true) return true;
  for (const k of ["status", "state", "liveStatus", "streamStatus", "streamingStatus", "operationalState", "broadcastStatus"]) if (isLiveWord(e[k])) return true;
  return false;
}

/* ───────────── Polling ───────────── */

let state: ResiStatus = { configured: false, connected: false, error: null, live: false, liveSince: null, lastLive: null, encoders: [], checkedAt: null, source: "none" };
let schedulesUnsupportedUntil = 0;
const liveSince = new Map<string, string>(); // encoder id → when we first saw it live
let loop: NodeJS.Timeout | null = null;
let backoffUntil = 0;

export const resiStatus = (): ResiStatus => state;

export async function pollResi(): Promise<ResiStatus> {
  const s = stored();
  if (!s.enabled || !s.clientId || !s.secretEnc) {
    state = { ...state, configured: false, connected: false, live: false, error: null, encoders: [] };
    return state;
  }
  try {
    const enc = list((await get<unknown>("/encoders")).body);
    // Live schedules: each one is an encoder going live to a destination group, with its destinations.
    let schedules: Record<string, unknown>[] | null = null;
    if (schedulesUnsupportedUntil < Date.now()) {
      const r = await get<unknown>("/schedules");
      if (r.status === 404 || r.status === 405 || r.status === 403) schedulesUnsupportedUntil = Date.now() + 3600_000;
      else schedules = list(r.body);
    }
    const now = new Date().toISOString();
    const watch = new Set(s.encoderIds);
    const encoders: ResiEncoder[] = enc
      .map((e) => ({ id: str(e.id) ?? str(e.uuid) ?? "", name: str(e.name) ?? "Encoder", raw: e }))
      .filter((e) => e.id && (!watch.size || watch.has(e.id)))
      .map(({ id, name, raw }) => {
        const mine = (schedules ?? []).filter((x) => str(x.encoderId) === id);
        const destinations = mine.flatMap((x) => list(x.destinations).map((d) => ({
          name: str(d.name) ?? str(d.type) ?? "Destination", type: str(d.type), status: str(d.status) ?? "UNKNOWN", title: str(x.title),
        })));
        const active = destinations.filter((d) => d.status !== "STOPPED" && d.status !== "ABORTED" && d.status !== "IDLE");
        const live = destinations.some((d) => isLiveWord(d.status)) || (schedules === null && encoderSaysLive(raw));
        if (live && !liveSince.has(id)) liveSince.set(id, now);
        if (!live) liveSince.delete(id);
        const title = mine.map((x) => str(x.title)).find(Boolean) ?? null;
        const err = destinations.find((d) => d.status === "ERROR");
        return {
          id, name, live, liveSince: liveSince.get(id) ?? null, title,
          state: live ? (destinations.some((d) => d.status === "STARTED") || schedules === null ? "live" : "starting") : err ? "error" : active.length ? "setting-up" : "off",
          destinations: active.length ? active : destinations.slice(0, 6),
          error: err ? `${err.name}: error` : null,
        } satisfies ResiEncoder;
      });
    const live = encoders.some((e) => e.live);
    const since = encoders.map((e) => e.liveSince).filter((x): x is string => Boolean(x)).sort()[0] ?? null;
    if (state.live && !live) state.lastLive = { from: state.liveSince ?? now, to: now };
    if (!state.live && live) logEvent(`resi: live (${encoders.filter((e) => e.live).map((e) => e.name).join(", ")})`);
    state = { configured: true, connected: true, error: null, live, liveSince: since, lastLive: state.lastLive, encoders, checkedAt: now, source: schedules === null ? "encoders" : "schedules" };
  } catch (e) {
    const status = e instanceof ResiError ? e.status : 0;
    if (status === 429) backoffUntil = Date.now() + 60_000;
    state = { ...state, configured: true, connected: false, error: (e as Error).message, checkedAt: new Date().toISOString() };
  }
  return state;
}

export function startResi() {
  if (loop) clearInterval(loop);
  loop = null;
  const s = stored();
  if (!s.enabled) { void pollResi(); return; }
  void pollResi();
  loop = setInterval(() => { if (Date.now() >= backoffUntil) void pollResi(); }, 10_000);
  loop.unref();
}

/** Preferences: the encoders on the account (to choose which to watch). */
export async function resiEncoders(): Promise<{ id: string; name: string }[]> {
  return list((await get<unknown>("/encoders")).body)
    .map((e) => ({ id: str(e.id) ?? str(e.uuid) ?? "", name: str(e.name) ?? "Encoder" }))
    .filter((e) => e.id);
}
