/**
 * Micboard inside Sundays.
 *
 * Sundays runs creativedamage/micboard (vendor/micboard, unchanged) with its own bundled
 * Python, exactly as `python py/micboard.py -f <config> -p <port> -b <backgrounds>` would run on
 * its own. Micboard serves its own page on the network at http://<this Mac>:<port> (8058 by
 * default), keeps its own config (receivers, slots, groups, extended names) and talks to the Shure
 * receivers. Sundays adapts to it through Micboard's own interfaces only:
 *
 *   • reads /data.json (receivers, slots, battery/RF/audio) — Sundays doesn't open its own
 *     receiver connections while Micboard runs;
 *   • adds Micboard's slots to Mic setup (matched by receiver IP and channel), so people can be put
 *     on them in each service's Mics panel;
 *   • sends who's on each mic as Micboard extended names (POST /api/slot);
 *   • puts pictures in Micboard's backgrounds folder: your own (Preferences → Micboard) and,
 *     if you like, Planning Center photos. Micboard shows <name>.jpg (or .mp4) behind each name.
 *     Bright pictures go in darkened just enough for Micboard's light names to read
 *     (readableBg.ts); the originals are kept in backgrounds-originals.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { MicChannel, MicKind, MicSetup, Receiver, ReceiverStatus, ShureModel } from "../../../shared/types.js";
import { config } from "../config.js";
import { extras, logEvent, mics } from "./db.js";
import { readableBackground } from "./readableBg.js";

/* ───────────── Settings ───────────── */

export interface MicboardSettings {
  enabled: boolean;
  port: number;
  /** Who's on each mic (from the service's Mics panel) as Micboard's extended names. */
  names: "first" | "full" | "off";
  /** Planning Center photos as backgrounds when you haven't added your own. */
  pcoPhotos: boolean;
  /** Darken bright pictures just enough for Micboard's light names to read. */
  readable: boolean;
}
const DEFAULTS: MicboardSettings = { enabled: true, port: 8058, names: "first", pcoPhotos: true, readable: true };
export const micboardSettings = (): MicboardSettings => ({ ...DEFAULTS, ...extras.get<Partial<MicboardSettings>>("micboard", {}) });
export function saveMicboardSettings(p: Partial<MicboardSettings>) {
  const before = micboardSettings();
  const next = { ...before, ...p };
  extras.set("micboard", next);
  if (before.readable !== next.readable) refreshReadable();
  if (before.port !== next.port || before.enabled !== next.enabled) restartMicboard();
  else void syncNow();
  return next;
}

/* ───────────── Where things are ───────────── */

/**
 * Micboard's runtime (its code, Python, Tornado): Contents/Resources/micboard in the Mac app (set by
 * desktop/src/main.ts as COOL_MICBOARD_NATIVE), else desktop/micboard-runtime next to app/server.cjs.
 */
function nativeDir() {
  if (process.env.COOL_MICBOARD_NATIVE) return process.env.COOL_MICBOARD_NATIVE;
  return path.join(__dirname, "..", "micboard-runtime");
}
const paths = () => {
  const n = nativeDir();
  return {
    python: path.join(n, "python", "bin", "python3.12"),
    runner: path.join(n, "micboard-run.py"),
    site: path.join(n, "micboard-site"),
    app: path.join(n, "micboard"),
  };
};
export const micboardDir = () => path.resolve(process.cwd(), config.dataDir, "micboard");
export const backgroundsDir = () => path.join(micboardDir(), "backgrounds");
/** The pictures as they came (yours and Planning Center's); Micboard gets readable copies. */
const originalsDir = () => path.join(micboardDir(), "backgrounds-originals");

export function micboardVersion(): string | null {
  try { return JSON.parse(fs.readFileSync(path.join(paths().app, "package.json"), "utf8")).version ?? null; } catch { return null; }
}

/* ───────────── Running it ───────────── */

export type MicboardRun = "off" | "starting" | "running" | "error" | "missing" | "companion";
let child: ChildProcess | null = null;
let run: MicboardRun = "off";
let error: string | null = null;
let wanted = false;
let restarts: number[] = [];
let restartTimer: NodeJS.Timeout | null = null;
const log: string[] = [];
const addLog = (s: string) => { for (const l of s.split(/\r?\n/)) if (l.trim()) { log.push(l); if (log.length > 200) log.shift(); } };

const portFree = (port: number) => new Promise<boolean>((resolve) => {
  const s = net.createServer();
  s.once("error", () => resolve(false));
  s.once("listening", () => s.close(() => resolve(true)));
  s.listen(port, "0.0.0.0");
});

export async function startMicboard() {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (child) return;
  const s = micboardSettings();
  if (extras.get("appMode", null) === "companion") { run = "companion"; error = null; return; }
  if (!s.enabled) { run = "off"; error = null; return; }
  const p = paths();
  if (!fs.existsSync(p.python) || !fs.existsSync(path.join(p.app, "py", "micboard.py"))) {
    run = "missing"; error = "Micboard isn’t included in this build of Sundays."; return;
  }
  if (!(await portFree(s.port))) {
    const other = await fetchJson<{ config?: { micboard_version?: string } }>(`http://127.0.0.1:${s.port}/data.json`, 1500).catch(() => null);
    run = "error";
    error = other?.config?.micboard_version
      ? `Another copy of Micboard is already running on port ${s.port}. Quit it (Sundays runs its own), or choose another port.`
      : `Port ${s.port} is in use by another app. Choose another port for Micboard.`;
    return;
  }
  fs.mkdirSync(backgroundsDir(), { recursive: true });
  wanted = true;
  run = "starting"; error = null;
  const c = spawn(p.python, [p.runner, "-f", micboardDir(), "-p", String(s.port), "-b", backgroundsDir()], {
    cwd: micboardDir(),
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? micboardDir(), LANG: "en_US.UTF-8",
      PYTHONPATH: p.site, PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1", PYTHONNOUSERSITE: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child = c;
  c.stdout?.on("data", (b: Buffer) => addLog(b.toString()));
  c.stderr?.on("data", (b: Buffer) => addLog(b.toString()));
  c.on("error", (e) => { addLog(String(e)); });
  c.on("exit", (code, signal) => {
    child = null;
    addLog(`Micboard stopped (${signal ?? `exit ${code}`})`);
    if (!wanted) { run = "off"; return; }
    const now = Date.now();
    restarts = [...restarts.filter((t) => now - t < 120_000), now];
    if (restarts.length >= 5) {
      run = "error";
      error = `Micboard keeps stopping. ${log.slice(-3).join(" · ")}`.slice(0, 400);
      return;
    }
    run = "starting";
    restartTimer = setTimeout(() => { restartTimer = null; void startMicboard(); }, 1500 * restarts.length);
  });
  logEvent(`micboard: started on port ${s.port}`);
  // Running once its page answers.
  for (let i = 0; i < 40 && child === c; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await fetchJson(`http://127.0.0.1:${s.port}/data.json`, 1000).then(() => true).catch(() => false)) { run = "running"; void syncNow(); break; }
  }
}

export function stopMicboard() {
  wanted = false;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  child?.kill("SIGTERM");
  run = "off";
}

export function restartMicboard() {
  restarts = [];
  const c = child;
  stopMicboard();
  if (!c) { void startMicboard(); return; }
  c.once("exit", () => void startMicboard());
  setTimeout(() => c.kill("SIGKILL"), 4000).unref();
}

process.on("exit", () => { wanted = false; child?.kill("SIGTERM"); });

export const micboardRunning = () => run === "running" && Boolean(child);
export function micboardStatus() {
  return { run, error, version: micboardVersion(), port: micboardSettings().port, log: log.slice(-40), folder: micboardDir() };
}

/* ───────────── Its data ───────────── */

async function fetchJson<T>(url: string, timeoutMs = 2000, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally { clearTimeout(t); }
}

export interface MbTx {
  slot: number; channel?: number; id: string; name: string; name_raw?: string; type: string; status: string;
  battery?: number; runtime?: string | number; antenna?: string; audio_level?: number; rf_level?: number; frequency?: string;
  raw?: Record<string, string>;
}
export interface MbReceiver { ip: string; type: string; status?: string; raw?: Record<string, string>; tx: MbTx[] }
export interface MbSlot { slot: number; type: string; ip?: string; channel?: number; extended_id?: string; extended_name?: string }
export interface MbData {
  receivers: MbReceiver[]; url: string; jpg: string[]; mp4: string[]; gif: string[];
  config: { slots: MbSlot[]; groups: { group: number; title: string; slots: number[] }[]; port?: number; micboard_version?: string };
}

let memo: { at: number; p: Promise<MbData> } | null = null;
/** Micboard's /data.json (shared for a second). */
export function micboardData(): Promise<MbData> {
  if (memo && Date.now() - memo.at < 900) return memo.p;
  const p = fetchJson<MbData>(`http://127.0.0.1:${micboardSettings().port}/data.json`, 2500);
  memo = { at: Date.now(), p };
  p.catch(() => { memo = null; });
  return p;
}

const MODEL: Record<string, ShureModel | undefined> = { ulxd: "ULXD", qlxd: "QLXD", axtd: "AD", uhfr: "UHFR" };
const MIC_TYPES = new Set(Object.keys(MODEL));
const val = (raw: Record<string, string> | undefined, ...keys: string[]) => {
  for (const k of keys) { const v = raw?.[k]?.trim(); if (v && !/^UNKN(OWN)?$/.test(v)) return v; }
  return null;
};

/** Receiver status (as Sundays shows it) from Micboard's data. */
export function statusesFromMicboard(d: MbData, setup: MicSetup = mics.setup()): ReceiverStatus[] {
  const at = new Date().toISOString();
  return setup.receivers.filter((r) => r.ip).map((r) => {
    const rx = d.receivers.find((x) => x.ip === r.ip.trim());
    if (!rx) return { receiverId: r.id, ok: false, error: "Not in Micboard", at, channels: [] };
    return {
      receiverId: r.id, ok: rx.status === "CONNECTED", at,
      error: rx.status === "CONNECTED" ? undefined : "Micboard can’t reach this receiver",
      channels: rx.tx.filter((t) => t.channel != null).map((t) => {
        const on = !["TX_COM_ERROR", "RX_COM_ERROR", "UNASSIGNED"].includes(t.status);
        const bars = t.battery != null && t.battery >= 0 && t.battery <= 5 ? t.battery : null;
        const rt = typeof t.runtime === "string" ? t.runtime.match(/^(\d+):(\d\d)$/) : null;
        const pct = Number(val(t.raw, "BATT_CHARGE", "TX_BATT_CHARGE_PERCENT"));
        const freq = t.frequency ? Number.parseFloat(t.frequency) : NaN;
        return {
          channel: t.channel!, name: t.name_raw ?? null, txOn: on,
          txModel: val(t.raw, "TX_TYPE", "TX_MODEL"),
          batteryBars: on ? bars : null,
          batteryMinutes: on && rt ? Number(rt[1]) * 60 + Number(rt[2]) : null,
          batteryPercent: on && pct >= 0 && pct <= 100 && val(t.raw, "BATT_CHARGE", "TX_BATT_CHARGE_PERCENT") ? pct : null,
          batteryType: val(t.raw, "BATT_TYPE", "TX_BATT_TYPE"),
          frequencyMHz: Number.isFinite(freq) && freq > 0 ? freq : null,
          antennas: on ? t.antenna ?? null : null,
          // Micboard scales RF to 0–100 (raw/115) and audio to 0–100; Sundays shows dBm and 0–50.
          rfDbm: on && t.rf_level != null ? Math.round(t.rf_level * 1.15 - 128) : null,
          audioLevel: on && t.audio_level != null ? Math.max(0, Math.min(50, Math.round(t.audio_level / 2))) : null,
          interference: val(t.raw, "RF_INT_DET", "INTERFERENCE_STATUS") === "CRITICAL",
          muted: val(t.raw, "TX_MUTE_STATUS", "AUDIO_MUTE") ? ["ON", "MUTE"].includes(val(t.raw, "TX_MUTE_STATUS", "AUDIO_MUTE")!) : null,
        };
      }),
    };
  });
}

/* ───────────── Starting Micboard from Mic setup ───────────── */

const MB_TYPE: Partial<Record<ShureModel, string>> = { ULXD: "ulxd", QLXD: "qlxd", AD: "axtd", UHFR: "uhfr" };

/**
 * A Micboard with no slots yet (a new install) gets the receivers and mics from Mic setup, through
 * Micboard's own config API (POST /api/config), so it shows the mics that were already set up in
 * Sundays. Once Micboard has slots, it's set up in Micboard (and Mic setup follows it).
 */
async function seedFromSetup(d: MbData): Promise<boolean> {
  if ((d.config.slots ?? []).length || extras.get("micboardSeeded", false)) return false;
  const setup = mics.setup();
  const rx = new Map(setup.receivers.map((r) => [r.id, r]));
  const slots: MbSlot[] = [];
  const offline: Record<string, string> = {};
  for (const c of setup.channels) {
    const r = c.receiverId ? rx.get(c.receiverId) : undefined;
    const type = r ? MB_TYPE[r.model] : undefined;
    if (r?.ip && type) slots.push({ slot: slots.length + 1, type, ip: r.ip.trim(), channel: c.channel });
    else if (!r?.ip) { const slot = slots.length + 1; slots.push({ slot, type: "offline", extended_id: c.label }); offline[slot] = c.id; }
  }
  if (!slots.some((s) => s.type !== "offline")) return false; // nothing on the network to show yet
  const r = await fetch(`http://127.0.0.1:${micboardSettings().port}/api/config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(slots), signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Micboard didn’t take the mic list (HTTP ${r.status})`);
  extras.set("micboardSeeded", true);
  extras.set("micboardOffline", offline);
  memo = null;
  logEvent(`micboard: set up ${slots.length} slots from Mic setup`);
  return true;
}

/* ───────────── Micboard's slots in Mic setup ───────────── */

const guessKind = (t: MbTx): MicKind => {
  const m = val(t.raw, "TX_TYPE", "TX_MODEL") ?? "";
  return /^(ULXD|QLXD|SLXD|AD|UR)1/.test(m) ? "pack" : "vocal";
};

/**
 * Every Micboard slot gets a mic in Mic setup (matched by receiver IP and channel; nothing of yours
 * is removed or renamed). Returns slot → Mic setup channel id.
 */
export function syncSetup(d: MbData): Map<number, string> {
  const setup = structuredClone(mics.setup());
  let changed = false;
  const bySlot = new Map<number, string>();
  const offline = extras.get<Record<string, string>>("micboardOffline", {}); // slot → channel id
  const txBySlot = new Map(d.receivers.flatMap((r) => r.tx.map((t) => [t.slot, t] as const)));

  for (const s of d.config.slots ?? []) {
    if (s.type === "offline") {
      let ch = setup.channels.find((c) => c.id === offline[s.slot]);
      if (!ch) {
        const label = s.extended_id || s.extended_name || `Slot ${s.slot}`;
        ch = setup.channels.find((c) => !c.receiverId && c.label === label);
        if (!ch) { ch = { id: `ch-mb-${s.slot}`, label, kind: "vocal", receiverId: null, channel: 1, positions: [] }; setup.channels.push(ch); changed = true; }
        offline[s.slot] = ch.id;
      }
      bySlot.set(s.slot, ch.id);
      continue;
    }
    if (!MIC_TYPES.has(s.type) || !s.ip || !s.channel) continue;
    const rxData = d.receivers.find((r) => r.ip === s.ip);
    let rx = setup.receivers.find((r) => r.ip.trim() === s.ip);
    if (!rx) {
      const model = MODEL[s.type]!;
      rx = { id: `rx-mb-${s.ip.replace(/\W/g, "-")}`, name: val(rxData?.raw, "DEVICE_ID") ?? `${model} ${s.ip}`, model, ip: s.ip, channels: s.channel };
      setup.receivers.push(rx); changed = true;
    }
    if (rx.channels < s.channel) { rx.channels = s.channel; changed = true; }
    let ch = setup.channels.find((c) => c.receiverId === rx!.id && c.channel === s.channel);
    if (!ch) {
      const t = txBySlot.get(s.slot);
      const label = s.extended_id || t?.id || t?.name_raw || `Slot ${s.slot}`;
      ch = { id: `ch-mb-${s.slot}`, label, kind: t ? guessKind(t) : "vocal", receiverId: rx.id, channel: s.channel, positions: [] } satisfies MicChannel;
      if (setup.channels.some((c) => c.id === ch!.id)) ch.id = `ch-mb-${s.slot}-${Date.now().toString(36)}`;
      setup.channels.push(ch); changed = true;
    }
    bySlot.set(s.slot, ch.id);
  }
  if (changed) { mics.saveSetup(setup); logEvent("micboard: added Micboard’s slots to Mic setup"); }
  extras.set("micboardOffline", offline);
  return bySlot;
}

/* ───────────── Names and pictures ───────────── */

/** Set by board.ts: the service the stage display follows, its mic assignments and roster photos. */
type PlanInfo = { assignments: { channelId: string; personId: string; name: string }[]; photos: Map<string, string | null> } | null;
let planSource: (() => Promise<PlanInfo>) | null = null;
export const setMicboardPlanSource = (fn: () => Promise<PlanInfo>) => { planSource = fn; };

/** Micboard's background file for a name: it shows "<name, lower case>.jpg" behind "Mollie". */
export const bgFileFor = (name: string, ext: "jpg" | "mp4" = "jpg") =>
  `${name.trim().toLowerCase().replace(/[/\\:\0]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}.${ext}`;

interface BgManifest { pco: Record<string, string>; custom: string[] }
const manifest = (): BgManifest => ({ pco: {}, custom: [], ...extras.get<Partial<BgManifest>>("micboardBackgrounds", {}) });
const saveManifest = (m: BgManifest) => extras.set("micboardBackgrounds", m);

/** Pictures in Micboard's backgrounds folder: yours, Planning Center's, or put there some other way. */
export function listBackgrounds() {
  const m = manifest();
  let names: string[] = [];
  try { names = fs.readdirSync(backgroundsDir()).filter((f) => /\.(jpg|mp4|gif)$/i.test(f)); } catch { /* none yet */ }
  return names.sort().map((file) => {
    const st = fs.statSync(path.join(backgroundsDir(), file));
    return { file, name: file.replace(/\.(jpg|mp4|gif)$/i, ""), kind: /\.mp4$/i.test(file) ? "video" as const : "image" as const,
      source: m.custom.includes(file) ? "yours" as const : m.pco[file] ? "pco" as const : "folder" as const, bytes: st.size, at: st.mtime.toISOString() };
  });
}

/** Changes whenever a picture's contents change, so displays load Micboard's page again. */
let bgRev = 0;
export const backgroundsRev = () => bgRev;

const writeAtomic = (dir: string, file: string, data: Buffer) => {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${file}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, path.join(dir, file));
};

/** A picture for Micboard: the original kept aside, and Micboard's copy (darkened if it needs it). */
function writePicture(file: string, original: Buffer) {
  writeAtomic(originalsDir(), file, original);
  const shown = micboardSettings().readable ? readableBackground(original).data : original;
  writeAtomic(backgroundsDir(), file, shown);
  readableState()[file] = micboardSettings().readable ? "on" : "off";
  extras.set("micboardReadable", readableState());
  bgRev++;
}
const readableState = (() => {
  let cache: Record<string, "on" | "off"> | null = null;
  return () => (cache ??= extras.get<Record<string, "on" | "off">>("micboardReadable", {}));
})();

/**
 * Bring Micboard's copies of Sundays' pictures (yours and Planning Center's) in line with the
 * Readable names setting. The first time, the picture in the folder is the original, so it's kept
 * aside first. Pictures put in the folder some other way are never changed.
 */
export function refreshReadable() {
  const m = manifest();
  const want = micboardSettings().readable ? "on" : "off";
  const state = readableState();
  let changed = false;
  for (const file of [...m.custom, ...Object.keys(m.pco)]) {
    if (!/\.jpg$/i.test(file) || state[file] === want) continue;
    const shown = path.join(backgroundsDir(), file), kept = path.join(originalsDir(), file);
    try {
      if (!fs.existsSync(kept)) { if (!fs.existsSync(shown)) continue; writeAtomic(originalsDir(), file, fs.readFileSync(shown)); }
      const original = fs.readFileSync(kept);
      writeAtomic(backgroundsDir(), file, want === "on" ? readableBackground(original).data : original);
      state[file] = want;
      changed = true;
    } catch (e) { logEvent(`micboard: couldn’t update the picture ${file}: ${(e as Error).message}`); }
  }
  if (changed) { extras.set("micboardReadable", state); bgRev++; memo = null; }
}

export function saveBackground(name: string, ext: "jpg" | "mp4", data: Buffer) {
  const file = bgFileFor(name, ext);
  if (!file.replace(/\.\w+$/, "")) throw new Error("Enter the name it’s for");
  if (ext === "jpg") writePicture(file, data);
  else { writeAtomic(backgroundsDir(), file, data); bgRev++; }
  const m = manifest();
  delete m.pco[file];
  m.custom = [...new Set([...m.custom, file])];
  saveManifest(m);
  memo = null;
  return file;
}

export function removeBackground(file: string) {
  if (!/^[^/\\]+\.(jpg|mp4|gif)$/i.test(file)) throw new Error("Not a background file");
  fs.rmSync(path.join(backgroundsDir(), file), { force: true });
  fs.rmSync(path.join(originalsDir(), file), { force: true });
  const state = readableState();
  if (state[file]) { delete state[file]; extras.set("micboardReadable", state); }
  const m = manifest();
  delete m.pco[file];
  m.custom = m.custom.filter((f) => f !== file);
  saveManifest(m);
  memo = null;
}

const isPhoto = (url: string | null | undefined): url is string =>
  Boolean(url && /^https:\/\//.test(url) && !/no_photo|\.svg(\?|$)/i.test(url));

let syncing = false;
const photoRetry = new Map<string, number>();
let lastSync: { at: string; error: string | null; names: number; photos: number } = { at: "", error: null, names: 0, photos: 0 };
export const micboardSync = () => lastSync;

/** Bring Micboard up to date: slots in Mic setup, names, Planning Center photos. */
export async function syncNow() {
  if (!micboardRunning() || syncing) return;
  syncing = true;
  try {
    const s = micboardSettings();
    let d = await micboardData();
    if (await seedFromSetup(d)) { await new Promise((r) => setTimeout(r, 2500)); d = await micboardData(); }
    const slotOf = syncSetup(d);
    const info = planSource ? await planSource().catch(() => null) : null;

    // Who's on each slot, by name (first names; full names where two people share one).
    const chanToSlot = new Map([...slotOf].map(([slot, ch]) => [ch, slot]));
    const assigned = (info?.assignments ?? []).filter((a) => chanToSlot.has(a.channelId));
    const firstOf = (n: string) => n.trim().split(/\s+/)[0] ?? n.trim();
    const sharing = new Map<string, Set<string>>(); // first name → people with it
    for (const a of assigned) sharing.set(firstOf(a.name), (sharing.get(firstOf(a.name)) ?? new Set()).add(a.personId));
    const display = (n: string) => (s.names === "full" || (sharing.get(firstOf(n))?.size ?? 0) > 1 ? n.trim() : firstOf(n));
    const want = new Map<number, { name: string; personId: string }>();
    if (s.names !== "off") for (const a of assigned) want.set(chanToSlot.get(a.channelId)!, { name: display(a.name), personId: a.personId });

    // Names: set ours, clear the ones we set that nobody's on now; leave names you typed in Micboard.
    // A mic whose receiver name has no ID in it ("VOX 1" rather than "H01 VOX") gets its Mic setup
    // name as Micboard's extended ID, so the board still says which mic it is.
    const pushed = extras.get<Record<string, string>>("micboardPushed", {});
    const updates: { slot: number; extended_id?: string; extended_name?: string }[] = [];
    const txBySlot = new Map(d.receivers.flatMap((r) => r.tx.map((t) => [t.slot, t] as const)));
    const labels = new Map(mics.setup().channels.map((c) => [c.id, c.label]));
    for (const sl of d.config.slots ?? []) {
      const w = want.get(sl.slot)?.name;
      const ours = pushed[sl.slot];
      if (w) {
        const label = labels.get(slotOf.get(sl.slot) ?? "");
        const id = sl.extended_id || (!txBySlot.get(sl.slot)?.id && label && label.toLowerCase() !== w.toLowerCase() ? label : "");
        if (sl.extended_name !== w || (id && sl.extended_id !== id)) updates.push({ slot: sl.slot, ...(id ? { extended_id: id } : {}), extended_name: w });
        pushed[sl.slot] = w;
      } else if (ours) {
        if (sl.extended_name === ours) updates.push({ slot: sl.slot, ...(sl.extended_id ? { extended_id: sl.extended_id } : {}) });
        delete pushed[sl.slot];
      }
    }
    if (updates.length) {
      await fetch(`http://127.0.0.1:${s.port}/api/slot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
      memo = null;
    }
    extras.set("micboardPushed", pushed);

    // Planning Center photos (never over a picture of yours).
    let photos = 0;
    if (s.pcoPhotos && info) {
      const m = manifest();
      await Promise.all([...want.values()].map(async ({ name, personId }) => {
        const url = info.photos.get(personId);
        const file = bgFileFor(name);
        if (!isPhoto(url) || m.custom.includes(file)) return;
        const exists = fs.existsSync(path.join(backgroundsDir(), file));
        if (exists && (m.pco[file] === url || !m.pco[file])) { if (m.pco[file]) photos++; return; } // ours already, or a file you put there
        if ((photoRetry.get(url) ?? 0) > Date.now()) return;
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
          if (!r.ok || !/^image\//.test(r.headers.get("content-type") ?? "image/")) throw new Error(`HTTP ${r.status}`);
          writePicture(file, Buffer.from(await r.arrayBuffer()));
          m.pco[file] = url;
          photos++;
        } catch { photoRetry.set(url, Date.now() + 5 * 60_000); } // try that one again in a few minutes
      }));
      saveManifest(m);
    }
    lastSync = { at: new Date().toISOString(), error: null, names: want.size, photos };
  } catch (e) {
    lastSync = { ...lastSync, at: new Date().toISOString(), error: (e as Error).message };
  } finally { syncing = false; }
}

let loop: NodeJS.Timeout | null = null;
/** Start Micboard (if it's on) and keep names and pictures in step every few seconds. */
export function initMicboard() {
  try { refreshReadable(); } catch (e) { logEvent(`micboard: couldn’t check the pictures: ${(e as Error).message}`); }
  void startMicboard();
  if (!loop) { loop = setInterval(() => void syncNow(), 5000); loop.unref(); }
}

/** A Mic setup receiver as Micboard sees it (for the "in Micboard" badge). */
export const inMicboard = (r: Receiver, d: MbData | null) => Boolean(d?.config.slots.some((s) => s.ip === r.ip.trim()));
