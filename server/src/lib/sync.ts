/**
 * Settings sync: every Mac you sign in to Sundays on gets the same setup.
 *
 * Your settings are kept in Sundays' cloud (Supabase, the sundays-sync function) under your
 * church and your Planning Center person. Each Mac sends its Planning Center sign-in; the function
 * checks it with Planning Center, so only you (signed in as you) can read or change them. They're
 * stored encrypted.
 *
 * How it works: every few seconds this compares each setting with what it last sent or received
 * (a hash). A setting changed here is sent, stamped with the time it changed. Every minute (and
 * at sign-in) the changes from your other Macs come down. The newest change of each setting wins.
 *
 * What syncs: Preferences (theme, logo, start-up view, Waves snapshot numbers), mics & packs and who's
 * on them, run sheet views, the Mic board / display and Clock setups, the Dashboard, campuses,
 * team groups, Parent paging, ProPresenter computers, the console, Smaart, Micboard and Resi, and
 * the picked weekend.
 * What stays on each Mac: how it's used (Full / Service Mode / FOH Companion, and the Service Mode
 * PIN), which screens and network pages it shows, its MIDI output, FOH companion links, sign-ins,
 * and Planning Center's own data (that's already in Planning Center).
 */
import crypto from "node:crypto";
import { SYNC_URL } from "../../../shared/cloud.js";
import type { SyncStatus } from "../../../shared/types.js";
import { usingPat } from "../config.js";
import { decrypt } from "./crypto.js";
import { extras, logEvent, mics, pagingStore, runSheetViews, settings, syncRaw, tokens as tokenStore, users } from "./db.js";
import { accessTokenFor } from "../auth/oauth.js";
import { applyBoardSync, boardSyncValue } from "./board.js";
import { applyClockSync, clockSyncValue } from "./clock.js";
import { resiSettings, saveResiSettings } from "./resi.js";
import { saveMicboardSettings, micboardSettings } from "./micboard.js";
import { setWeekend, weekend } from "./weekend.js";

interface Item { key: string; read: () => unknown; write: (v: unknown) => void }
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** A plain extras key, synced as a whole. */
const extra = (key: string, fallback: unknown = null): Item => ({ key: `x:${key}`, read: () => extras.get(key, fallback), write: (v) => extras.set(key, v) });

const ITEMS: Item[] = [
  {
    key: "settings",
    // The MIDI output is this Mac's own (its IAC bus or network session).
    read: () => { const s = settings.get(); const { output: _o, ...waves } = s.waves; return { ...s, waves }; },
    write: (v) => { const x = obj(v); const cur = settings.get(); settings.save({ ...x, waves: { ...cur.waves, ...obj(x.waves), output: cur.waves.output } }); },
  },
  { key: "micSetup", read: () => syncRaw.get("micSetup"), write: (v) => { if (v) mics.saveSetup(v as Parameters<typeof mics.saveSetup>[0]); } },
  { key: "planMics", read: () => syncRaw.get("planMics"), write: (v) => syncRaw.set("planMics", obj(v)) },
  { key: "micUsual", read: () => syncRaw.get("micUsual"), write: (v) => syncRaw.set("micUsual", obj(v)) },
  { key: "runSheetViews", read: () => runSheetViews.list(), write: (v) => syncRaw.set("runSheetViews", Array.isArray(v) ? v : []) },
  {
    // Parent paging: ministries, messages and the iPad PINs (not which iPads are signed in here).
    key: "paging",
    read: () => { const p = pagingStore.get(); return p ? { config: p.config, pins: p.pins } : null; },
    write: (v) => {
      const x = obj(v);
      if (!x.config) return;
      const cur = pagingStore.get();
      pagingStore.set({ ...(cur ?? { kioskSessions: [], owner: null }), config: x.config, pins: obj(x.pins) } as Parameters<typeof pagingStore.set>[0]);
    },
  },
  { key: "board", read: boardSyncValue, write: applyBoardSync },
  { key: "clock", read: clockSyncValue, write: applyClockSync },
  {
    key: "resi",
    // The secret goes along (the cloud copy is encrypted) so you don't type it again on each Mac.
    read: () => {
      const s = extras.get<{ secretEnc?: string | null }>("resi", {});
      let secret: string | null = null;
      try { secret = s.secretEnc ? decrypt(s.secretEnc) : null; } catch { secret = null; }
      const v = resiSettings();
      return { enabled: v.enabled, clientId: v.clientId, encoderIds: v.encoderIds, secret };
    },
    write: (v) => {
      const x = obj(v);
      saveResiSettings({
        enabled: Boolean(x.enabled), clientId: String(x.clientId ?? ""), encoderIds: Array.isArray(x.encoderIds) ? (x.encoderIds as string[]) : [],
        ...(typeof x.secret === "string" && x.secret ? { clientSecret: x.secret } : {}),
      });
    },
  },
  {
    // Micboard: names and photos; its port and on/off are this Mac's.
    key: "micboard",
    read: () => { const { port: _p, enabled: _e, ...rest } = micboardSettings(); return rest; },
    write: (v) => { const x = obj(v); const { port: _p, enabled: _e, ...rest } = x; void saveMicboardSettings(rest); },
  },
  { key: "weekend", read: () => weekend(), write: (v) => { if (v === null || typeof v === "string") setWeekend(v as string | null); } },
  extra("dashboard"), extra("home"), extra("campuses"), extra("teamGroups"), extra("knownTeams"),
  extra("volunteerCheckIn"), extra("proMachines"), extra("console"), extra("smaart"),
];

/* ───────────── State ───────────── */

interface Meta { hash: string; at: string }
interface Stored { device: string; since: string | null; meta: Record<string, Meta>; personKey: string | null }
const KEY = "sync";
const load = (): Stored => ({ device: crypto.randomUUID(), since: null, meta: {}, personKey: null, ...extras.get<Partial<Stored>>(KEY, {}) });
let st = load();
const persist = () => extras.set(KEY, st);
if (!extras.get<Partial<Stored>>(KEY, {}).device) persist();

let status: SyncStatus = { enabled: Boolean(SYNC_URL), state: "idle", who: null, lastSync: null, error: null, keys: ITEMS.length };
export const syncStatus = (): SyncStatus => status;

const hash = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v ?? null)).digest("base64").slice(0, 22);

/** The Planning Center person whose settings this Mac uses: whoever signed in most recently (not sample data). */
function owner() {
  if (usingPat()) return null; // one shared Planning Center account: nothing personal to sync
  return users.list()
    .filter((u) => tokenStore.get(u.id))
    .sort((a, b) => b.lastLoginAt.localeCompare(a.lastLoginAt))[0] ?? null;
}

async function call<T>(token: string, body: unknown): Promise<T> {
  const r = await fetch(`${SYNC_URL}/functions/v1/sundays-sync`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-PCO-Token": token }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Sync failed (HTTP ${r.status})`);
  return j;
}

type Remote = { key: string; value: unknown; updatedAt: string; device: string | null };

/** Take a change from another Mac (if it's newer than ours). */
function apply(r: Remote): boolean {
  const item = ITEMS.find((i) => i.key === r.key);
  if (!item) return false;
  const mine = st.meta[r.key];
  if (mine && Date.parse(mine.at) >= Date.parse(r.updatedAt)) return false;
  try {
    item.write(r.value);
  } catch (e) {
    logEvent(`sync: couldn’t apply ${r.key} (${(e as Error).message})`);
    return false;
  }
  // Store the hash of what we have now (writing may normalise it), so it isn't sent straight back.
  st.meta[r.key] = { hash: hash(item.read()), at: r.updatedAt };
  return true;
}

let running = false;
let lastPull = 0;
let pending = false;

/** One round: send what changed here, and (every minute, or when asked) take what changed elsewhere. */
export async function syncNow(opts: { pull?: boolean } = {}): Promise<SyncStatus> {
  if (!SYNC_URL) return status;
  if (running) { pending = true; return status; }
  const u = owner();
  if (!u) { status = { ...status, state: "signed-out", who: null, error: null }; return status; }
  running = true;
  try {
    const token = await accessTokenFor(u.id);
    if (!token) { status = { ...status, state: "signed-out", who: null }; return status; }
    // A different person on this Mac: start fresh (theirs come down first, then ours go up as changes).
    const personKey = `${u.pcoOrgId}:${u.pcoPersonId}`;
    if (st.personKey !== personKey) { st = { ...st, personKey, since: null, meta: {} }; persist(); opts.pull = true; }
    const first = st.since === null;
    let changed = 0;

    // Down first on a first sync, so a new Mac takes your setup instead of overwriting it with defaults.
    if (opts.pull || first || Date.now() - lastPull > 60_000) {
      status = { ...status, state: "syncing" };
      const res = await call<{ items: Remote[]; now: string }>(token, { op: "pull", since: st.since });
      for (const r of res.items) if (apply(r)) changed++;
      st.since = res.now;
      lastPull = Date.now();
      // Settings this Mac has never synced: a first sync only fills in, it doesn't clobber.
      if (first) for (const i of ITEMS) st.meta[i.key] ??= { hash: "", at: new Date(0).toISOString() };
    }

    // Up: settings whose value changed since we last sent/received them.
    const now = new Date().toISOString();
    const out = ITEMS.map((i) => ({ i, v: i.read() })).filter(({ i, v }) => st.meta[i.key]?.hash !== hash(v));
    if (out.length) {
      status = { ...status, state: "syncing" };
      const res = await call<{ saved: string[]; newer: Remote[]; now: string }>(token, {
        op: "push", device: st.device, items: out.map(({ i, v }) => ({ key: i.key, value: v, updatedAt: now })),
      });
      for (const k of res.saved) { const it = out.find((o) => o.i.key === k)!; st.meta[k] = { hash: hash(it.v), at: now }; }
      for (const r of res.newer) if (apply(r)) changed++;
    }
    persist();
    if (changed) logEvent(`sync: ${changed} setting${changed === 1 ? "" : "s"} from your other Macs`);
    status = { ...status, state: "ok", who: u.name, lastSync: new Date().toISOString(), error: null };
  } catch (e) {
    status = { ...status, state: "error", error: (e as Error).message };
  } finally {
    running = false;
    if (pending) { pending = false; setTimeout(() => void syncNow(), 1000).unref(); }
  }
  return status;
}

let loop: NodeJS.Timeout | null = null;
/** Started with the server. Quick local checks (cheap: hashes), the cloud only when something changed or each minute. */
export function startSync() {
  if (!SYNC_URL || loop) return;
  setTimeout(() => void syncNow({ pull: true }), 3000).unref();
  loop = setInterval(() => void syncNow(), 10_000);
  loop.unref();
}
