/**
 * Parent paging: put a child's security code on the auditorium screens as a ProPresenter message.
 *
 * - One page at a time. ProPresenter shows the message for `onScreenSeconds` (15s by default,
 *   matching the church's ProPresenter setup); nobody can page again until it's gone. The lock is
 *   held here on the server, so the app and every iPad see the same countdown.
 * - Each ministry (Nursery, Kids) either gets its own ProPresenter message that Cool Services
 *   keeps up to date ("Cool Services · Nursery", with the chosen theme), or triggers an existing one.
 * - Only the security code goes to the screen.
 */
import crypto from "node:crypto";
import { MINISTRIES, type Ministry, type MinistryPaging, type PageEvent, type PageRequest, type PagingConfig, type PagingStatus } from "../../../shared/types.js";
import { audit, pagingStore, type PagingStored } from "./db.js";
import { ProPresenter, ProPresenterError } from "./propresenter.js";

export const KIOSK_PORT = 47130;

const defaultMinistry = (m: Ministry): Omit<MinistryPaging, "hasPin"> => ({
  enabled: true,
  title: m === "nursery" ? "Nursery" : "Kids",
  locationIds: [],
  mode: "managed",
  text: m === "nursery" ? "Nursery: {code}" : "Kids: {code}",
  theme: null,
  existing: null,
});

const defaults = (): PagingStored => ({
  config: {
    propresenter: { host: "", port: 0 },
    onScreenSeconds: 15,
    ipads: { enabled: false, port: KIOSK_PORT },
    ministries: { nursery: defaultMinistry("nursery"), kids: defaultMinistry("kids") },
    approval: true,
  },
  pins: {},
  kioskSessions: [],
  owner: null,
});

export function stored(): PagingStored {
  const d = defaults();
  const s = pagingStore.get();
  if (!s) return d;
  return {
    ...d, ...s,
    config: {
      ...d.config, ...s.config,
      propresenter: { ...d.config.propresenter, ...s.config?.propresenter },
      ipads: { ...d.config.ipads, ...s.config?.ipads },
      ministries: {
        nursery: { ...d.config.ministries.nursery, ...s.config?.ministries?.nursery },
        kids: { ...d.config.ministries.kids, ...s.config?.ministries?.kids },
      },
    },
  };
}

/** The config as the app sees it (PINs reduced to "is one set"). */
export function publicConfig(): PagingConfig {
  const s = stored();
  const ministries = Object.fromEntries(MINISTRIES.map((m) => [m, { ...s.config.ministries[m], hasPin: Boolean(s.pins[m]) }])) as PagingConfig["ministries"];
  return { ...s.config, ministries };
}

const listeners = new Set<() => void>();
export const onPagingChange = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export function saveConfig(patch: Partial<Omit<PagingConfig, "ministries">> & { ministries?: Partial<Record<Ministry, Partial<Omit<MinistryPaging, "hasPin">>>> }, owner?: PagingStored["owner"]) {
  const s = stored();
  const next: PagingStored = {
    ...s,
    owner: owner ?? s.owner,
    config: {
      ...s.config, ...patch,
      propresenter: { ...s.config.propresenter, ...patch.propresenter },
      ipads: { ...s.config.ipads, ...patch.ipads, hostnames: { ...s.config.ipads.hostnames, ...patch.ipads?.hostnames } },
      ministries: {
        nursery: { ...s.config.ministries.nursery, ...patch.ministries?.nursery },
        kids: { ...s.config.ministries.kids, ...patch.ministries?.kids },
      },
    },
  };
  pagingStore.set(next);
  messageIds.clear(); // text/theme may have changed
  for (const fn of listeners) fn();
  return publicConfig();
}

/* ───────────── PINs and iPad sessions ───────────── */

const scrypt = (pin: string, salt: string) => crypto.scryptSync(pin, salt, 32).toString("hex");

/** Set (or clear) a ministry's PIN. A new PIN signs out that ministry's iPads. */
export function setPin(m: Ministry, pin: string | null) {
  const s = stored();
  const version = (s.pins[m]?.version ?? 0) + 1;
  if (pin) {
    const salt = crypto.randomBytes(16).toString("hex");
    s.pins[m] = { hash: scrypt(pin, salt), salt, version };
  } else {
    delete s.pins[m];
  }
  s.kioskSessions = s.kioskSessions.filter((k) => k.ministry !== m);
  pagingStore.set(s);
}

/** Wrong PINs: 5 tries per iPad, then a 1-minute wait (doubling each time). */
const attempts = new Map<string, { fails: number; until: number; strikes: number }>();

export function unlock(m: Ministry, pin: string, who: string): { token: string } | { error: string; waitSeconds?: number } {
  const s = stored();
  const key = `${m}:${who}`;
  const a = attempts.get(key) ?? { fails: 0, until: 0, strikes: 0 };
  if (a.until > Date.now()) return { error: "too_many_tries", waitSeconds: Math.ceil((a.until - Date.now()) / 1000) };
  const p = s.pins[m];
  if (!p) return { error: "no_pin" };
  const ok = crypto.timingSafeEqual(Buffer.from(scrypt(pin, p.salt), "hex"), Buffer.from(p.hash, "hex"));
  if (!ok) {
    a.fails++;
    if (a.fails >= 5) { a.strikes++; a.fails = 0; a.until = Date.now() + 60_000 * 2 ** (a.strikes - 1); }
    attempts.set(key, a);
    return { error: "wrong_pin" };
  }
  attempts.delete(key);
  const token = crypto.randomBytes(32).toString("base64url");
  const nowIso = new Date().toISOString();
  s.kioskSessions = [...s.kioskSessions.filter((k) => Date.parse(k.lastSeen) > Date.now() - 90 * 864e5), { token, ministry: m, pinVersion: p.version, createdAt: nowIso, lastSeen: nowIso }];
  pagingStore.set(s);
  return { token };
}

/** Is this iPad signed in to this ministry? */
export function kioskSession(m: Ministry, token: string | undefined): boolean {
  if (!token) return false;
  const s = stored();
  const k = s.kioskSessions.find((x) => x.token === token && x.ministry === m);
  if (!k || s.pins[m]?.version !== k.pinVersion) return false;
  if (Date.now() - Date.parse(k.lastSeen) > 3600e3) { k.lastSeen = new Date().toISOString(); pagingStore.set(s); }
  return true;
}

export function signOutIpads(m: Ministry) {
  const s = stored();
  s.kioskSessions = s.kioskSessions.filter((k) => k.ministry !== m);
  pagingStore.set(s);
}

/* ───────────── Paging ───────────── */

let onScreenUntil = 0;
let current: PageEvent | null = null;
const recent: PageEvent[] = [];
let clearTimer: NodeJS.Timeout | null = null;
/** "<ministry>" → uuid of our managed message, so each page is one request. */
const messageIds = new Map<Ministry, string>();

export const pp = () => {
  const { host, port } = stored().config.propresenter;
  return new ProPresenter(host, port);
};

export function status(): PagingStatus {
  const cfg = stored().config;
  const locked = onScreenUntil > Date.now();
  const day = new Date(); day.setHours(0, 0, 0, 0);
  return {
    configured: Boolean(cfg.propresenter.host && cfg.propresenter.port),
    onScreenUntil: locked ? new Date(onScreenUntil).toISOString() : null,
    current: locked ? current : null,
    recent: recent.filter((e) => Date.parse(e.at) >= day.getTime()).slice(0, 25),
    requests: requests.filter((r) => Date.parse(r.requestedAt) >= day.getTime() || r.state === "waiting" || r.state === "released").slice(0, 40),
    approval: cfg.approval,
    serverTime: new Date().toISOString(),
  };
}

export class PagingError extends Error {
  constructor(public code: "on_screen" | "not_configured" | "no_code" | "disabled" | "propresenter", message: string, public status = 400) { super(message); }
}

/** Security codes are short letters/numbers; anything else is refused before it reaches the screen. */
export function cleanCode(raw: string) {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/.test(code)) throw new PagingError("no_code", "Enter the security code from the child's tag (letters and numbers).");
  return code;
}

export async function page(m: Ministry, rawCode: string, opts: { by: string; actorId: string; childName?: string | null }): Promise<PageEvent> {
  const code = cleanCode(rawCode);
  const s = stored();
  const cfg = s.config;
  const min = cfg.ministries[m];
  if (!min.enabled) throw new PagingError("disabled", `${min.title} paging is turned off in Settings.`);
  if (!cfg.propresenter.host || !cfg.propresenter.port) throw new PagingError("not_configured", "Add the ProPresenter computer in Settings first.");
  if (onScreenUntil > Date.now()) {
    const left = Math.ceil((onScreenUntil - Date.now()) / 1000);
    throw new PagingError("on_screen", `A page is on screen. You can page again in ${left} second${left === 1 ? "" : "s"}.`, 409);
  }
  // Take the lock straight away, so two iPads pressing at once can't both go through.
  const seconds = Math.max(3, Math.min(600, cfg.onScreenSeconds || 15));
  onScreenUntil = Date.now() + seconds * 1000;
  const ev: PageEvent = { id: crypto.randomUUID(), ministry: m, code, childName: opts.childName ?? null, by: opts.by, at: new Date().toISOString(), ok: true };

  const pro = pp();
  try {
    let id: string, token: string;
    if (min.mode === "existing") {
      if (!min.existing) throw new PagingError("not_configured", `Choose which ProPresenter message ${min.title} uses, in Settings.`);
      id = min.existing.id.uuid || min.existing.id.name;
      token = min.existing.token;
    } else {
      id = messageIds.get(m) ?? await pro.ensureMessage(`Cool Services · ${min.title}`, min.text.includes("{code}") ? min.text : `${min.text} {code}`, min.theme);
      messageIds.set(m, id);
      token = "code";
    }
    try {
      await pro.trigger(id, token, code);
    } catch (e) {
      // Our message was deleted in ProPresenter: make it again once.
      if (min.mode === "managed" && e instanceof ProPresenterError && e.status === 404) {
        messageIds.delete(m);
        id = await pro.ensureMessage(`Cool Services · ${min.title}`, min.text, min.theme);
        messageIds.set(m, id);
        await pro.trigger(id, token, code);
      } else throw e;
    }
    // Take it down when the time's up (harmless if ProPresenter already hid it).
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { pro.clear(id).catch(() => {}); }, seconds * 1000);
    current = ev;
    recent.unshift(ev);
    recent.splice(50);
    void audit(opts.actorId, "page.parent", "ministry", m, { code, by: opts.by });
    return ev;
  } catch (e) {
    onScreenUntil = 0;
    const msg = e instanceof PagingError || e instanceof ProPresenterError ? e.message : (e as Error).message;
    recent.unshift({ ...ev, ok: false, error: msg });
    recent.splice(50);
    if (e instanceof PagingError) throw e;
    throw new PagingError("propresenter", msg, 502);
  }
}

/** Send a test page (a made-up code) — still respects the on-screen lock. */
export const testPage = (m: Ministry, by: string, actorId: string) => page(m, "TEST", { by, actorId, childName: "Test" });

/* ───────────── Page requests (approval) ───────────── */

/**
 * With approval on, an iPad's page becomes a request. It waits (a banner in Cool Services shows it)
 * until someone sends it; then it goes on the screens as soon as nothing else is showing, one after
 * another. Kept in memory: requests are for the service that's happening now.
 */
const requests: PageRequest[] = [];
let pumpTimer: NodeJS.Timeout | null = null;
const requestListeners = new Set<(r: PageRequest) => void>();
export const onPageRequest = (fn: (r: PageRequest) => void) => { requestListeners.add(fn); return () => requestListeners.delete(fn); };

export function requestPage(m: Ministry, rawCode: string, opts: { by: string; actorId: string; childName?: string | null }): PageRequest {
  const code = cleanCode(rawCode);
  const cfg = stored().config;
  if (!cfg.ministries[m].enabled) throw new PagingError("disabled", `${cfg.ministries[m].title} paging is turned off.`);
  // The same code asked for twice: one request.
  const same = requests.find((r) => r.ministry === m && r.code === code && (r.state === "waiting" || r.state === "released"));
  if (same) return same;
  const r: PageRequest = { id: crypto.randomUUID(), ministry: m, code, childName: opts.childName ?? null, by: opts.by, requestedAt: new Date().toISOString(), state: "waiting" };
  requests.unshift(r);
  requests.splice(200);
  void audit(opts.actorId, "page.request", "ministry", m, { code, by: opts.by });
  for (const fn of requestListeners) fn(r);
  return r;
}

function finish(r: PageRequest, state: PageRequest["state"], error?: string) {
  r.state = state; r.doneAt = new Date().toISOString(); if (error) r.error = error;
}

/** Send the next released request when the screen is free. */
async function pump() {
  if (pumpTimer) { clearTimeout(pumpTimer); pumpTimer = null; }
  const next = [...requests].reverse().find((r) => r.state === "released"); // oldest first
  if (!next) return;
  const wait = onScreenUntil - Date.now();
  if (wait > 0) { pumpTimer = setTimeout(() => void pump(), wait + 400); return; }
  try {
    await page(next.ministry, next.code, { by: next.by, actorId: "request", childName: next.childName });
    finish(next, "sent");
  } catch (e) {
    if (e instanceof PagingError && e.code === "on_screen") { pumpTimer = setTimeout(() => void pump(), 1000); return; }
    finish(next, "failed", (e as Error).message);
  }
  if (requests.some((r) => r.state === "released")) pumpTimer = setTimeout(() => void pump(), Math.max(0, onScreenUntil - Date.now()) + 400);
}

export function sendRequest(id: string): PageRequest {
  const r = requests.find((x) => x.id === id);
  if (!r) throw new PagingError("no_code", "That request isn’t there any more.", 404);
  if (r.state === "waiting" || r.state === "failed") { r.state = "released"; delete r.error; void pump(); }
  return r;
}

export function sendAllRequests(m?: Ministry) {
  for (const r of requests) if (r.state === "waiting" && (!m || r.ministry === m)) r.state = "released";
  void pump();
}

export function cancelRequest(id: string): PageRequest {
  const r = requests.find((x) => x.id === id);
  if (!r) throw new PagingError("no_code", "That request isn’t there any more.", 404);
  if (r.state === "waiting" || r.state === "released" || r.state === "failed") finish(r, "cancelled");
  return r;
}
