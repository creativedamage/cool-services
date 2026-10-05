/**
 * FOH companion computers.
 *
 * Main computer: shows a 6-digit pairing code (Preferences → Network Connections). A companion that
 * sends the code gets a token; with it, it can see page requests (ministry and tag code only, never a
 * child's name) and Accept, Hold until clear, or Deny them. This runs on the same network listener
 * as the Kids & Nursery iPad pages.
 *
 * Companion computer: finds the main one on the network, pairs once, then asks for requests every
 * second and brings its window to the front when a new one arrives. In between, it can show a mic
 * strip: a short always-on-top bar across the bottom of a display with the main computer's wireless
 * mics (name, who's on it, status, battery), leaving the rest of the screen free for other apps.
 */
import crypto from "node:crypto";
import os from "node:os";
import type { BoardTile } from "../../../shared/board.js";
import type { CompanionInfo, CompanionRequest, CompanionState, CompanionStrip, CompanionTuning } from "../../../shared/types.js";
import { extras, logEvent } from "./db.js";
import { cancelRequest, holdRequest, sendRequest, status, stored } from "./paging.js";
import { pagingStore } from "./db.js";
import { localSubnets, portOpen } from "./propresenter.js";

const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

/* ───────────── Main computer ───────────── */

let pairing: { code: string; until: number } | null = null;
const tries = new Map<string, { n: number; until: number }>();

export function startPairing(): { code: string; expiresAt: string } {
  pairing = { code: String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"), until: Date.now() + 10 * 60_000 };
  return { code: pairing.code, expiresAt: new Date(pairing.until).toISOString() };
}
export const pairingOpen = () => Boolean(pairing && pairing.until > Date.now());

export function pairWithCode(code: string, name: string, who: string): { token: string } | { error: string } {
  const t = tries.get(who) ?? { n: 0, until: 0 };
  if (t.until > Date.now()) return { error: "Too many wrong codes. Wait a minute and try again." };
  if (!pairing || pairing.until < Date.now()) return { error: "No pairing code is showing on the main computer. Press “Pair a companion” there first." };
  if (code !== pairing.code) {
    t.n++; if (t.n >= 5) { t.n = 0; t.until = Date.now() + 60_000; }
    tries.set(who, t);
    return { error: "That code isn’t right." };
  }
  tries.delete(who);
  pairing = null;
  const token = crypto.randomBytes(32).toString("base64url");
  const s = stored();
  s.companions = [...(s.companions ?? []), { id: crypto.randomUUID(), name: name.slice(0, 60) || "FOH companion", tokenHash: sha(token), pairedAt: new Date().toISOString(), lastSeen: null }];
  pagingStore.set(s);
  logEvent(`companion: paired "${name}"`);
  return { token };
}

const seen = new Map<string, number>();
export function companionFor(token: string | undefined) {
  if (!token) return null;
  const c = (stored().companions ?? []).find((x) => x.tokenHash === sha(token));
  if (c) seen.set(c.id, Date.now());
  return c ?? null;
}

export function listCompanions(): CompanionInfo[] {
  return (stored().companions ?? []).map((c) => ({
    id: c.id, name: c.name, pairedAt: c.pairedAt,
    lastSeen: seen.get(c.id) ? new Date(seen.get(c.id)!).toISOString() : c.lastSeen,
    online: Date.now() - (seen.get(c.id) ?? 0) < 10_000,
  }));
}

export function removeCompanion(id: string) {
  const s = stored();
  s.companions = (s.companions ?? []).filter((c) => c.id !== id);
  pagingStore.set(s);
}

/** Requests as a companion may see them. */
export function companionView(): { requests: CompanionRequest[]; onScreenUntil: string | null } {
  const st = status();
  const titles = stored().config.ministries;
  return {
    onScreenUntil: st.onScreenUntil,
    requests: st.requests
      .filter((r) => r.state === "waiting" || r.state === "released")
      .map((r) => ({ id: r.id, ministry: titles[r.ministry]?.title ?? r.ministry, code: r.code, requestedAt: r.requestedAt, state: r.state, heldAt: r.heldAt })),
  };
}

export function companionAct(id: string, action: "accept" | "hold" | "deny", by: string) {
  if (action === "accept") sendRequest(id, by);
  else if (action === "deny") cancelRequest(id, by);
  else holdRequest(id, by);
}

/* ───────────── Companion computer ───────────── */

interface Link { host: string; port: number; token: string; name: string }
const link = () => extras.get<Link | null>("companionLink", null);

const DEFAULT_STRIP: CompanionStrip = { enabled: true, size: "m", displayId: null, displayLabel: null, tuning: true };
export const stripSettings = (): CompanionStrip => ({ ...DEFAULT_STRIP, ...extras.get<Partial<CompanionStrip>>("companionStrip", {}) });
export function saveStrip(p: Partial<CompanionStrip>) {
  extras.set("companionStrip", { ...stripSettings(), ...p });
  state = { ...state, strip: stripSettings() };
  applyStrip();
  return stripSettings();
}
/** The Mac app's windows: the mic strip, and the full companion window. */
interface WindowBridge { strip: (s: CompanionStrip & { on: boolean }) => void; open: (view: "full" | "strip") => void }
let windows: WindowBridge | null = null;
export const setCompanionWindowBridge = (b: WindowBridge) => { windows = b; applyStrip(); };
export const showCompanionWindow = (view: "full" | "strip") => windows?.open(view);
function applyStrip() {
  const s = stripSettings();
  windows?.strip({ ...s, on: s.enabled && extras.get("appMode", null) === "companion" && Boolean(link()) });
}

let state: CompanionState = { linked: false, main: null, connected: false, requests: [], onScreenUntil: null, mics: [], tuning: null, strip: stripSettings() };
let attention: ((on: boolean) => void) | null = null;
export const setAttentionBridge = (fn: (on: boolean) => void) => { attention = fn; };
let loop: NodeJS.Timeout | null = null;
let wantedAttention = false;

async function call<T>(l: { host: string; port: number; token?: string }, path: string, body?: unknown, timeoutMs = 2500): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://${l.host}:${l.port}/api/companion${path}`, {
      method: body ? "POST" : "GET", signal: ctl.signal,
      headers: { "Content-Type": "application/json", ...(l.token ? { Authorization: `Bearer ${l.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.message ?? j.error ?? `HTTP ${r.status}`), { status: r.status });
    return j as T;
  } finally { clearTimeout(t); }
}

/** Sundays computers on this network that accept companions. */
export async function findMains(): Promise<{ host: string; port: number; name: string }[]> {
  const ports = [47130, 80];
  const targets: { host: string; port: number }[] = [];
  for (const { base } of localSubnets().slice(0, 3)) for (let i = 1; i < 255; i++) for (const port of ports) targets.push({ host: `${base}.${i}`, port });
  const open: { host: string; port: number }[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 128 }, async () => {
    while (next < targets.length) { const t = targets[next++]; if (await portOpen(t.host, t.port, 300)) open.push(t); }
  }));
  const found = await Promise.all(open.map((o) => call<{ app: string; name: string }>(o, "/hello", undefined, 1500).then((h) => (h.app === "cool-services" ? { ...o, name: h.name } : null)).catch(() => null)));
  return found.filter((x): x is { host: string; port: number; name: string } => Boolean(x));
}

export async function linkTo(host: string, port: number, code: string) {
  const hello = await call<{ app: string; name: string }>({ host, port }, "/hello");
  if (hello.app !== "cool-services") throw new Error("That isn’t a Sundays computer.");
  const r = await call<{ token?: string; error?: string }>({ host, port }, "/pair", { code, name: os.hostname().replace(/\.local$/, "") });
  if (!r.token) throw new Error(r.error ?? "Pairing didn’t work.");
  extras.set("companionLink", { host, port, token: r.token, name: hello.name } satisfies Link);
  startCompanion();
  await poll();
  return companionState();
}

export async function unlink() { extras.set("companionLink", null); startCompanion(); await poll(); }

export const companionState = (): CompanionState => state;

/** A Tuning key pressed on this companion: the main computer sends it to Waves. */
export async function pressTuning(slot: string): Promise<{ ok: boolean; snapshot?: number; error?: string }> {
  const l = link();
  if (!l) throw new Error("Not linked");
  const r = await call<{ ok: boolean; snapshot?: number; error?: string }>(l, "/tuning", { slot }, 8000);
  void poll();
  return r;
}

export async function act(id: string, action: "accept" | "hold" | "deny") {
  const l = link();
  if (!l) throw new Error("Not linked");
  await call(l, "/act", { id, action });
  await poll();
  return state;
}

async function poll() {
  const l = link();
  if (!l) { state = { linked: false, main: null, connected: false, requests: [], onScreenUntil: null, mics: [], tuning: null, strip: stripSettings() }; setAttention(false); return; }
  try {
    const v = await call<{ requests: CompanionRequest[]; onScreenUntil: string | null; mics?: BoardTile[]; tuning?: CompanionTuning | null }>(l, "/state");
    state = { linked: true, main: { name: l.name, host: l.host, port: l.port }, connected: true, requests: v.requests, onScreenUntil: v.onScreenUntil, mics: v.mics ?? state.mics, tuning: v.tuning ?? null, strip: stripSettings() };
  } catch (e) {
    const status = (e as { status?: number }).status;
    state = { ...state, linked: true, main: { name: l.name, host: l.host, port: l.port }, connected: false,
      error: status === 401 ? "The main computer no longer knows this companion. Pair it again." : `Can’t reach ${l.name} (${l.host}).` };
  }
  // Take over the screen while a request is waiting that nobody has held.
  setAttention(state.requests.some((r) => r.state === "waiting" && !r.heldAt));
}

function setAttention(on: boolean) {
  if (on === wantedAttention) return;
  wantedAttention = on;
  attention?.(on);
}

export function startCompanion() {
  if (loop) clearInterval(loop);
  loop = null;
  applyStrip();
  if (extras.get("appMode", null) !== "companion" || !link()) { void poll(); return; }
  void poll();
  loop = setInterval(() => void poll(), 1000);
}
