/**
 * The stage display: mic board or clock, chosen in the app or following the service (the
 * mic board from before each rehearsal and service until it ends, the idle choice otherwise).
 *
 * The board joins three things: the mic setup (which mic is on which receiver channel), this
 * service's mic assignments (who has which mic), and the receivers' live status (battery, RF,
 * audio; read-only, see shure.ts). Names and photos come from the service's roster in Planning
 * Center, or from pictures uploaded in Sundays.
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BOARD, TILE_COLORS, activeLogo, type BoardBackground, type LogoRule, type BoardSettings, type BoardTile, type DisplayState, type DisplayView, type TileStatus } from "../../../shared/board.js";
import type { ChannelStatus, DisplayInfo, PlanDetail, ReceiverStatus } from "../../../shared/types.js";
import { pcoForUser } from "../auth/oauth.js";
import type { PcoApi } from "../pco/api.js";
import { config } from "../config.js";
import { cache, extras, files, logEvent, mics } from "./db.js";
import { readReceiver } from "./shure.js";
import { weekend, weekendPlan, onWeekendChange } from "./weekend.js";

interface Stored { settings: BoardSettings; owner: { userId: string; demo: boolean } | null; open?: { serviceTypeId: string; planId: string } | null }
const KEY = "board";

function load(): Stored {
  const s = extras.get<Partial<Stored>>(KEY, {});
  const settings = { ...DEFAULT_BOARD, ...s.settings } as BoardSettings;
  settings.hidden ??= [];
  settings.banner = { ...DEFAULT_BOARD.banner, ...s.settings?.banner };
  settings.screen = { ...DEFAULT_BOARD.screen, ...s.settings?.screen };
  settings.center = { ...DEFAULT_BOARD.center, ...s.settings?.center };
  settings.backgrounds ??= [];
  settings.logos ??= [];
  settings.logoSchedule ??= [];
  // The logo from before the schedule (1.40) is the first in the logos library, and the default.
  if (settings.center.logoId && !settings.logos.some((l) => l.id === settings.center.logoId)) {
    const p = files.path(settings.center.logoId);
    if (p) settings.logos.push({ id: settings.center.logoId, name: "Logo", bytes: fs.statSync(p).size, at: fs.statSync(p).mtime.toISOString() });
  }
  settings.tileText ??= {};
  settings.tileColor ??= {};
  settings.customImages ??= {};
  delete (settings as { micboard?: unknown }).micboard; // Micboard was removed in 1.40
  // Pictures uploaded before the library (1.40) join it, so they sync and can be picked again.
  for (const id of new Set(Object.values(settings.customImages))) {
    if (!settings.backgrounds.some((b) => b.id === id)) {
      const p = files.path(id);
      if (p) settings.backgrounds.push({ id, name: "Picture", bytes: fs.statSync(p).size, at: fs.statSync(p).mtime.toISOString() });
    }
  }
  // Stage plots were removed in 1.22: a display set to the stage plot shows the mic board.
  if ((settings.mode as string) === "stageplot") settings.mode = "micboard";
  if ((settings.autoIdle as string) === "stageplot") settings.autoIdle = "micboard";
  // "Always the next service" became the picked weekend's service in 1.25.
  if ((settings.follow as string) !== "open") settings.follow = "weekend";
  return { settings, owner: s.owner ?? null, open: s.open ?? null };
}
let stored = load();
const persist = () => extras.set(KEY, stored);
onWeekendChange(() => { memo = null; planMemo = null; });

/** Settings sync (every Mac you sign in on): the display settings, without this Mac's screen and network choices. */
export function boardSyncValue() {
  const { screen: _s, lan: _l, ...rest } = stored.settings;
  return rest;
}
export function applyBoardSync(v: unknown) {
  if (!v || typeof v !== "object") return;
  const cur = stored.settings;
  extras.set(KEY, { ...stored, settings: { ...cur, ...(v as Partial<BoardSettings>), screen: cur.screen, lan: cur.lan } });
  stored = load();
  memo = null; planMemo = null;
  for (const fn of listeners) fn(stored.settings);
}

export const boardSettings = () => stored.settings;
const listeners = new Set<(s: BoardSettings) => void>();
export function saveBoardSettings(patch: Partial<BoardSettings>) {
  const cur = stored.settings;
  stored.settings = {
    ...cur, ...patch,
    banner: { ...cur.banner, ...patch.banner }, screen: { ...cur.screen, ...patch.screen }, center: { ...cur.center, ...patch.center },
    customImages: patch.customImages ?? cur.customImages, hidden: patch.hidden ?? cur.hidden ?? [],
    backgrounds: patch.backgrounds ?? cur.backgrounds, logos: patch.logos ?? cur.logos, logoSchedule: patch.logoSchedule ?? cur.logoSchedule, tileText: patch.tileText ?? cur.tileText, tileColor: patch.tileColor ?? cur.tileColor,
  };
  persist();
  memo = null;
  for (const fn of listeners) fn(stored.settings);
  return stored.settings;
}
export function setBoardOwner(owner: { userId: string; demo: boolean }) {
  if (stored.owner?.userId === owner.userId && stored.owner.demo === owner.demo) return;
  stored.owner = owner;
  persist();
}
/** The service last opened in Sundays (the board follows it when follow is "open"). */
export function setOpenPlan(serviceTypeId: string, planId: string) {
  if (stored.open?.planId === planId && stored.open.serviceTypeId === serviceTypeId) return;
  stored.open = { serviceTypeId, planId };
  persist();
  memo = null;
}
const pco = (): PcoApi | null => (stored.owner ? pcoForUser(stored.owner.userId, stored.owner.demo) : null);

/** Registered by desktop/src/main.ts (the second-display window). */
let displays: DisplayInfo[] = [];
export const boardOutputs = {
  settings: () => stored.settings,
  onSettings: (fn: (s: BoardSettings) => void) => { listeners.add(fn); },
  setDisplays: (d: typeof displays) => { displays = d; },
};
export const boardDisplays = () => displays;

/* ───────────── Receivers ───────────── */

/** Every receiver with an IP, read directly (read-only, shure.ts), at most every 2 seconds however many screens are watching. */
export async function micStatuses(): Promise<ReceiverStatus[]> {
  const rxs = mics.setup().receivers.filter((r) => r.ip);
  if (!rxs.length) return [];
  const key = `mics:status:${rxs.map((r) => r.id).join(",")}`;
  return cache.wrap(key, 2, () => Promise.all(rxs.map((r) => readReceiver(r))));
}

function statusOf(c: ChannelStatus | undefined, rxOk: boolean | null): { status: TileStatus; note: string | null } {
  if (rxOk === null) return { status: "noreceiver", note: null };
  if (!rxOk) return { status: "offline", note: "Receiver offline" };
  if (!c || !c.txOn) return { status: "txoff", note: "TX off" };
  if (c.interference) return { status: "critical", note: "RF interference" };
  const bars = c.batteryBars, mins = c.batteryMinutes;
  if ((bars !== null && bars <= 1) || (mins !== null && mins <= 30)) return { status: "critical", note: "Change battery" };
  if ((bars !== null && bars <= 2) || (mins !== null && mins <= 60)) return { status: "low", note: "Low battery" };
  return { status: "ok", note: null };
}

/* ───────────── Which service, and which view ───────────── */


const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function autoView(plan: PlanDetail | null, idle: DisplayView): { view: DisplayView; reason: string } {
  if (!plan) return { view: idle, reason: weekend() ? "No service that weekend" : "Pick a weekend in Sundays" };
  const now = Date.now();
  const within = (t: PlanDetail["times"][number], before: number, after: number) =>
    now >= Date.parse(t.startsAt) - before && now <= Date.parse(t.endsAt || t.startsAt) + after;
  const reh = plan.times.find((t) => t.kind === "rehearsal" && within(t, 30 * 60e3, 0));
  if (reh) return { view: "micboard", reason: `Rehearsal ${clock(reh.startsAt)}` };
  const svc = plan.times.find((t) => t.kind === "service" && within(t, 60 * 60e3, 15 * 60e3));
  if (svc) return { view: "micboard", reason: `${clock(svc.startsAt)} service` };
  return { view: idle, reason: "Between services" };
}

/* ───────────── The state every display draws ───────────── */

let memo: { at: number; p: Promise<DisplayState> } | null = null;
export function displayState(): Promise<DisplayState> {
  if (memo && Date.now() - memo.at < 1500) return memo.p;
  const p = build().catch((e): DisplayState => ({
    view: stored.settings.mode === "auto" ? stored.settings.autoIdle : stored.settings.mode, mode: stored.settings.mode, reason: "",
    settings: centerSettings(stored.settings), service: null, tiles: [],
    error: (e as Error).message, at: new Date().toISOString(),
  }));
  memo = { at: Date.now(), p };
  return p;
}

const imageUrl = (fileId: string) => `/api/board-out/image/${encodeURIComponent(fileId)}`;

/** The service the display follows (the picked weekend's, or the one open in Sundays), looked up every 10 s at most. */
let planMemo: { at: number; key: string; p: Promise<PlanDetail | null> } | null = null;
export function boardPlan(): Promise<PlanDetail | null> {
  const s = stored.settings;
  const key = JSON.stringify([s.follow, s.serviceTypeId, stored.open, stored.owner, weekend()]);
  if (planMemo && planMemo.key === key && Date.now() - planMemo.at < 10_000) return planMemo.p;
  const p = (async () => {
    const api = pco();
    if (!api) return null;
    const opened = s.follow === "open" && stored.open ? await api.getPlan(stored.open.serviceTypeId, stored.open.planId).catch(() => null) : null;
    return opened ?? (await weekendPlan(api, s.serviceTypeId).catch(() => null));
  })();
  planMemo = { at: Date.now(), key, p };
  return p;
}
/** What the display needs from the settings (the logo as an address, not the picture itself). */
function centerSettings(s: BoardSettings): DisplayState["settings"] {
  const { logoId } = activeLogo(s, new Date());
  const logo = logoId && files.path(logoId) ? imageUrl(logoId) : null;
  return { banner: s.banner, columns: s.columns, names: s.names ?? "first", center: { logo, clock: s.center.clock, seconds: s.center.seconds, date: s.center.date } };
}

/** A background named like the person ("Eddie", "eddie smith") is theirs without picking it. */
const plain = (x: string) => x.trim().toLowerCase().replace(/\s+/g, " ");
function namedBackground(s: BoardSettings, person: { name: string; firstName: string }): string | null {
  const full = plain(person.name), first = plain(person.firstName);
  return (s.backgrounds.find((b) => plain(b.name) === full) ?? s.backgrounds.find((b) => plain(b.name) === first))?.id ?? null;
}

async function build(): Promise<DisplayState> {
  const s = stored.settings;
  const api = pco();
  const plan = await boardPlan();
  const { view, reason } = s.mode === "auto" ? autoView(plan, s.autoIdle) : { view: s.mode, reason: "Chosen in Sundays" };

  const setup = mics.setup();
  const assignments = plan ? mics.plan(plan.id).assignments : [];
  const statuses = await micStatuses().catch(() => [] as ReceiverStatus[]);
  const roster = new Map((plan?.roster ?? []).map((m) => [m.personId, m]));

  const hidden = new Set(s.hidden ?? []);
  const known = new Set(s.backgrounds.map((b) => b.id));
  const pick = (id: string | undefined) => (id && known.has(id) ? id : null);
  let tiles: BoardTile[] = setup.channels
    .map((c, i) => ({ c, i })) // i: its place in Mic setup, for its color
    .filter(({ c }) => s.kinds.includes(c.kind) && !hidden.has(c.id))
    .map(({ c, i }) => {
      const rx = setup.receivers.find((r) => r.id === c.receiverId) ?? null;
      const rs = rx?.ip ? statuses.find((x) => x.receiverId === rx.id) : undefined;
      const ch = rs?.channels.find((x) => x.channel === c.channel);
      const a = assignments.find((x) => x.channelId === c.id);
      const member = a ? roster.get(a.personId) : undefined;
      const name = a?.name ?? null;
      const { status, note } = statusOf(ch, rx?.ip ? (rs ? rs.ok : false) : null);
      const custom = (a && pick(s.customImages[`person:${a.personId}`])) || pick(s.customImages[`mic:${c.id}`])
        || (a && name ? namedBackground(s, { name, firstName: name.trim().split(/\s+/)[0] ?? name }) : null) || null;
      const pcoPhoto = member?.avatarUrl ?? null;
      const image = s.images === "none" ? null
        : s.images === "custom" ? (custom ? imageUrl(custom) : null)
        : s.images === "pco" ? pcoPhoto
        : custom ? imageUrl(custom) : pcoPhoto;
      return {
        channelId: c.id, micLabel: c.label, kind: c.kind, receiverName: rx?.name ?? null, channel: c.channel,
        person: a && name ? { id: a.personId, name, firstName: name.trim().split(/\s+/)[0] ?? name, position: member?.positionName ?? null } : null,
        image, status, note,
        battery: ch?.txOn ? { bars: ch.batteryBars, minutes: ch.batteryMinutes, percent: ch.batteryPercent } : null,
        rf: ch?.txOn ? { antennas: ch.antennas, dbm: ch.rfDbm } : null,
        audio: ch?.txOn ? ch.audioLevel ?? null : null,
        muted: Boolean(ch?.muted), frequencyMHz: ch?.frequencyMHz ?? null, txModel: ch?.txModel ?? null,
        networked: Boolean(rx?.ip), extras: [],
        color: s.tileColor[c.id] || TILE_COLORS[i % TILE_COLORS.length], text: s.tileText[c.id]?.trim() || null,
      };
    })
    .filter((t) => !s.hideUnassigned || t.person);

  // One tile per person: their other mics stack onto the tile of their (first networked) mic.
  if (s.stack ?? true) {
    const byPerson = new Map<string, BoardTile[]>();
    for (const t of tiles) if (t.person) byPerson.set(t.person.id, [...(byPerson.get(t.person.id) ?? []), t]);
    const drop = new Set<string>();
    for (const list of byPerson.values()) {
      if (list.length < 2) continue;
      const main = list.find((t) => t.networked) ?? list[0];
      main.extras = list.filter((t) => t !== main).map((t) => {
        drop.add(t.channelId);
        return { channelId: t.channelId, micLabel: t.micLabel, networked: t.networked, status: t.status, note: t.note, bars: t.battery?.bars ?? null, minutes: t.battery?.minutes ?? null, percent: t.battery?.percent ?? null };
      });
    }
    tiles = tiles.filter((t) => !drop.has(t.channelId));
  }

  const now = Date.now();
  const next = plan?.times.filter((t) => t.kind === "service" && Date.parse(t.endsAt || t.startsAt) > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  return {
    view, mode: s.mode, reason, settings: centerSettings(s),
    service: plan ? {
      planId: plan.id, serviceTypeId: plan.serviceTypeId, title: plan.title, serviceTypeName: plan.serviceTypeName,
      when: new Date(plan.sortDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      nextTime: next ? clock(next.startsAt) : null,
    } : null,
    tiles, error: api ? null : "Open the Mic board in Sundays once so the display can read Planning Center.",
    at: new Date().toISOString(),
  };
}

/** Files the display may show without signing in: the backgrounds library and the logo. */
export function publicImage(fileId: string): boolean {
  const s = stored.settings;
  return s.center.logoId === fileId || s.backgrounds.some((b) => b.id === fileId) || s.logos.some((l) => l.id === fileId);
}

/* ───────────── Backgrounds library and logo (the files sync to your other Macs, sync.ts) ───────────── */

const MAX_BACKGROUNDS = 60;
type Pic = { data: Buffer; ext: "png" | "jpg" | "webp" };
export function pictureFrom(dataUrl: string): Pic {
  const m = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw Object.assign(new Error("Use a PNG, JPG or WebP picture"), { status: 400 });
  const data = Buffer.from(m[2], "base64");
  // Each picture syncs to your other Macs on its own, and the sync takes up to about 650 KB.
  if (data.length > 650_000) throw Object.assign(new Error("That picture is too big (over 650 KB after shrinking). Try a smaller one."), { status: 400 });
  return { data, ext: m[1] === "jpeg" ? "jpg" : (m[1] as "png" | "webp") };
}

export function addBackground(name: string, pic: Pic): BoardBackground {
  const s = stored.settings;
  if (s.backgrounds.length >= MAX_BACKGROUNDS) throw Object.assign(new Error(`The library holds ${MAX_BACKGROUNDS} pictures. Remove some first.`), { status: 400 });
  const id = files.save(pic.data, pic.ext);
  const bg = { id, name: name.trim() || "Picture", bytes: pic.data.length, at: new Date().toISOString() };
  saveBoardSettings({ backgrounds: [...s.backgrounds, bg] });
  return bg;
}
export function renameBackground(id: string, name: string) {
  saveBoardSettings({ backgrounds: stored.settings.backgrounds.map((b) => (b.id === id ? { ...b, name: name.trim() || b.name } : b)) });
}
/** Out of the library, and off every person and mic it was picked for. */
export function removeBackground(id: string) {
  const s = stored.settings;
  const p = s.center.logoId === id || s.logos.some((l) => l.id === id) ? null : files.path(id);
  if (p) fs.rmSync(p, { force: true });
  saveBoardSettings({
    backgrounds: s.backgrounds.filter((b) => b.id !== id),
    customImages: Object.fromEntries(Object.entries(s.customImages).filter(([, v]) => v !== id)),
  });
}
/** A new logo in the logos library; the first one becomes the default. */
export function addLogo(name: string, pic: Pic): BoardBackground {
  const s = stored.settings;
  if (s.logos.length >= 30) throw Object.assign(new Error("You have 30 logos. Remove some first."), { status: 400 });
  const logo = { id: files.save(pic.data, pic.ext), name: name.trim() || "Logo", bytes: pic.data.length, at: new Date().toISOString() };
  saveBoardSettings({ logos: [...s.logos, logo], center: s.center.logoId ? s.center : { ...s.center, logoId: logo.id } });
  return logo;
}
export function renameLogo(id: string, name: string) {
  saveBoardSettings({ logos: stored.settings.logos.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l)) });
}
/** Out of the library, off the schedule, and no longer the default. */
export function removeLogo(id: string) {
  const s = stored.settings;
  if (!s.backgrounds.some((b) => b.id === id)) { const p = files.path(id); if (p) fs.rmSync(p, { force: true }); }
  saveBoardSettings({
    logos: s.logos.filter((l) => l.id !== id), logoSchedule: s.logoSchedule.filter((r) => r.logoId !== id),
    center: s.center.logoId === id ? { ...s.center, logoId: null } : s.center,
  });
}
export function setDefaultLogo(id: string | null) {
  const s = stored.settings;
  saveBoardSettings({ center: { ...s.center, logoId: id && s.logos.some((l) => l.id === id) ? id : null } });
}
export function setLogoSchedule(rules: LogoRule[]) {
  const known = new Set(stored.settings.logos.map((l) => l.id));
  saveBoardSettings({ logoSchedule: rules.filter((r) => known.has(r.logoId)) });
}
/** The files other Macs need: every background and the logo. */
export function syncedFiles(): string[] {
  const s = stored.settings;
  return [...new Set([...s.backgrounds.map((b) => b.id), ...s.logos.map((l) => l.id), ...(s.center.logoId ? [s.center.logoId] : [])])];
}

/**
 * Micboard (removed in 1.40) kept the pictures you gave it, named after people. Bring yours into
 * the library once, under the same names, so they still show behind those people.
 */
function importMicboardBackgrounds() {
  if (extras.get("boardImportedMicboard", false)) return;
  extras.set("boardImportedMicboard", true);
  const mine = extras.get<{ custom?: string[] }>("micboardBackgrounds", {}).custom ?? [];
  const dir = path.resolve(process.cwd(), config.dataDir, "micboard");
  let added = 0;
  for (const file of mine.filter((f) => /\.jpg$/i.test(f))) {
    const src = [path.join(dir, "backgrounds-originals", file), path.join(dir, "backgrounds", file)].find((p) => fs.existsSync(p));
    if (!src) continue;
    const name = file.replace(/\.jpg$/i, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    try { addBackground(name.replace(/\b\w/g, (c) => c.toUpperCase()), { data: fs.readFileSync(src), ext: "jpg" }); added++; } catch { /* library full */ }
  }
  if (added) logEvent(`mic board: ${added} background${added === 1 ? "" : "s"} from Micboard added to the library`);
}
importMicboardBackgrounds();
