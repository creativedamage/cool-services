/**
 * The stage display: mic board (Micboard) or clock, chosen in the app or following the service (the
 * mic board from before each rehearsal and service until it ends, the idle choice otherwise).
 *
 * The board joins three things: the mic setup (which mic is on which receiver channel), this
 * service's mic assignments (who has which mic), and the receivers' live status (battery, RF,
 * audio; read-only, see shure.ts). Names and photos come from the service's roster in Planning
 * Center, or from pictures uploaded in Sundays.
 */
import crypto from "node:crypto";
import { DEFAULT_BOARD, type BoardSettings, type BoardTile, type DisplayState, type DisplayView, type TileStatus } from "../../../shared/board.js";
import type { ChannelStatus, DisplayInfo, PlanDetail, ReceiverStatus } from "../../../shared/types.js";
import { pcoForUser } from "../auth/oauth.js";
import type { PcoApi } from "../pco/api.js";
import { cache, extras, mics } from "./db.js";
import { readReceiver } from "./shure.js";
import { weekend, weekendPlan, onWeekendChange } from "./weekend.js";
import { backgroundsRev, micboardData, micboardRunning, micboardStatus, setMicboardPlanSource, statusesFromMicboard } from "./micboard.js";

interface Stored { settings: BoardSettings; owner: { userId: string; demo: boolean } | null; open?: { serviceTypeId: string; planId: string } | null }
const KEY = "board";

function load(): Stored {
  const s = extras.get<Partial<Stored>>(KEY, {});
  const settings = { ...DEFAULT_BOARD, ...s.settings } as BoardSettings;
  settings.hidden ??= [];
  settings.banner = { ...DEFAULT_BOARD.banner, ...s.settings?.banner };
  settings.screen = { ...DEFAULT_BOARD.screen, ...s.settings?.screen };
  settings.micboard = { ...DEFAULT_BOARD.micboard, ...s.settings?.micboard };
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
    banner: { ...cur.banner, ...patch.banner }, screen: { ...cur.screen, ...patch.screen }, micboard: { ...cur.micboard, ...patch.micboard },
    customImages: patch.customImages ?? cur.customImages, hidden: patch.hidden ?? cur.hidden ?? [],
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

/**
 * Every receiver with an IP. While Micboard runs, from Micboard (it's already talking to the
 * receivers); otherwise read directly, at most every 2 seconds however many screens are watching.
 */
export async function micStatuses(): Promise<ReceiverStatus[]> {
  const rxs = mics.setup().receivers.filter((r) => r.ip);
  const d = micboardRunning() ? await micboardData().catch(() => null) : null;
  // Micboard's readings for the receivers it's connected to; every other receiver (not in Micboard
  // yet, a model Micboard doesn't support like SLX-D, or one Micboard can't reach) is read directly,
  // as before Micboard was built in.
  const fromMb = d ? statusesFromMicboard(d).filter((s) => s.ok) : [];
  const direct = rxs.filter((r) => !fromMb.some((s) => s.receiverId === r.id));
  if (!direct.length) return fromMb;
  const key = `mics:status:${direct.map((r) => r.id).join(",")}`;
  const read = await cache.wrap(key, 2, () => Promise.all(direct.map((r) => readReceiver(r))));
  return rxs.map((r) => fromMb.find((s) => s.receiverId === r.id) ?? read.find((s) => s.receiverId === r.id)!).filter(Boolean);
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
    settings: { banner: stored.settings.banner, columns: stored.settings.columns, imageStyle: stored.settings.imageStyle }, micboard: null, service: null, tiles: [],
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
// Micboard's names and photos follow the same service.
setMicboardPlanSource(async () => {
  const plan = await boardPlan();
  if (!plan) return null;
  return {
    assignments: mics.plan(plan.id).assignments,
    photos: new Map(plan.roster.map((m) => [m.personId, m.avatarUrl ?? null])),
  };
});

/** Micboard's #hash: group, TV view and info drawer, backgrounds (see Micboard's js/app.js). */
function micboardHash(m: BoardSettings["micboard"]) {
  const parts: string[] = [];
  if (m.group) parts.push(`group=${m.group}`);
  if (m.view !== "desk") { parts.push(`tvmode=${m.view}`); if (m.backgrounds !== "NONE") parts.push(`bgmode=${m.backgrounds}`); }
  return parts.length ? `#${parts.join("&")}` : "";
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
  let tiles: BoardTile[] = setup.channels
    .filter((c) => s.kinds.includes(c.kind) && !hidden.has(c.id))
    .map((c) => {
      const rx = setup.receivers.find((r) => r.id === c.receiverId) ?? null;
      const rs = rx?.ip ? statuses.find((x) => x.receiverId === rx.id) : undefined;
      const ch = rs?.channels.find((x) => x.channel === c.channel);
      const a = assignments.find((x) => x.channelId === c.id);
      const member = a ? roster.get(a.personId) : undefined;
      const name = a?.name ?? null;
      const { status, note } = statusOf(ch, rx?.ip ? (rs ? rs.ok : false) : null);
      const custom = (a && s.customImages[`person:${a.personId}`]) || s.customImages[`mic:${c.id}`] || null;
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
        return { channelId: t.channelId, micLabel: t.micLabel, networked: t.networked, status: t.status, note: t.note, bars: t.battery?.bars ?? null, minutes: t.battery?.minutes ?? null };
      });
    }
    tiles = tiles.filter((t) => !drop.has(t.channelId));
  }

  const now = Date.now();
  const next = plan?.times.filter((t) => t.kind === "service" && Date.parse(t.endsAt || t.startsAt) > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const mb = micboardStatus();
  const mbData = micboardRunning() ? await micboardData().catch(() => null) : null;
  return {
    view, mode: s.mode, reason, settings: { banner: s.banner, columns: s.columns, imageStyle: s.imageStyle },
    micboard: mb.run === "off" || mb.run === "companion" ? null : {
      running: micboardRunning(), port: mb.port, hash: micboardHash(s.micboard ?? DEFAULT_BOARD.micboard), error: mb.error,
      // Micboard reads its list of pictures when its page loads: a new picture reloads the display.
      rev: mbData ? crypto.createHash("sha1").update([...mbData.jpg, ...mbData.mp4].sort().join("|") + `#${backgroundsRev()}`).digest("hex").slice(0, 12) : "",
    },
    service: plan ? {
      planId: plan.id, serviceTypeId: plan.serviceTypeId, title: plan.title, serviceTypeName: plan.serviceTypeName,
      when: new Date(plan.sortDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      nextTime: next ? clock(next.startsAt) : null,
    } : null,
    tiles, error: api ? null : "Open the Mic board in Sundays once so the display can read Planning Center.",
    at: new Date().toISOString(),
  };
}

/** Files the display may show without signing in: the board's pictures. */
export function publicImage(fileId: string): boolean {
  return Object.values(stored.settings.customImages).includes(fileId);
}
