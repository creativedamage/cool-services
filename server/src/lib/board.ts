/**
 * The stage display: mic board, stage plot or clock, chosen in the app or following the service
 * (stage plot during rehearsal times, mic board during service times).
 *
 * The board joins three things: the mic setup (which mic is on which receiver channel), this
 * service's mic assignments (who has which mic), and the receivers' live status (battery, RF,
 * audio; read-only, see shure.ts). Names and photos come from the service's roster in Planning
 * Center, or from pictures uploaded in Cool Services.
 */
import { DEFAULT_BOARD, type BoardSettings, type BoardTile, type DisplayState, type DisplayView, type TileStatus } from "../../../shared/board.js";
import type { ChannelStatus, PlanDetail, ReceiverStatus } from "../../../shared/types.js";
import { pcoForUser } from "../auth/oauth.js";
import type { PcoApi } from "../pco/api.js";
import { cache, extras, mics, plots } from "./db.js";
import { readReceiver } from "./shure.js";

interface Stored { settings: BoardSettings; owner: { userId: string; demo: boolean } | null }
const KEY = "board";

function load(): Stored {
  const s = extras.get<Partial<Stored>>(KEY, {});
  const settings = { ...DEFAULT_BOARD, ...s.settings } as BoardSettings;
  settings.banner = { ...DEFAULT_BOARD.banner, ...s.settings?.banner };
  settings.screen = { ...DEFAULT_BOARD.screen, ...s.settings?.screen };
  return { settings, owner: s.owner ?? null };
}
let stored = load();
const persist = () => extras.set(KEY, stored);

export const boardSettings = () => stored.settings;
const listeners = new Set<(s: BoardSettings) => void>();
export function saveBoardSettings(patch: Partial<BoardSettings>) {
  const cur = stored.settings;
  stored.settings = {
    ...cur, ...patch,
    banner: { ...cur.banner, ...patch.banner }, screen: { ...cur.screen, ...patch.screen },
    customImages: patch.customImages ?? cur.customImages,
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
const pco = (): PcoApi | null => (stored.owner ? pcoForUser(stored.owner.userId, stored.owner.demo) : null);

/** Registered by desktop/src/main.ts (the second-display window). */
let displays: { id: number; label: string; primary: boolean }[] = [];
export const boardOutputs = {
  settings: () => stored.settings,
  onSettings: (fn: (s: BoardSettings) => void) => { listeners.add(fn); },
  setDisplays: (d: typeof displays) => { displays = d; },
};
export const boardDisplays = () => displays;

/* ───────────── Receivers ───────────── */

/** Every receiver with an IP, read at most every 2 seconds however many screens are watching. */
export function micStatuses(): Promise<ReceiverStatus[]> {
  return cache.wrap("mics:status", 2, async () => {
    const rxs = mics.setup().receivers.filter((r) => r.ip);
    return Promise.all(rxs.map((r) => readReceiver(r)));
  });
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

async function currentPlan(api: PcoApi, st: string | null): Promise<PlanDetail | null> {
  const now = Date.now();
  const plans = (await api.listUpcomingPlans(st ?? undefined)).filter((p) => Date.parse(p.sortDate) > now - 14 * 3600e3).slice(0, 4);
  let first: PlanDetail | null = null;
  for (const p of plans) {
    const d = await api.getPlan(p.serviceTypeId, p.id).catch(() => null);
    if (!d) continue;
    first ??= d;
    // The first one that isn't over yet.
    const end = Math.max(...d.times.map((t) => Date.parse(t.endsAt || t.startsAt)).filter(Number.isFinite), Date.parse(d.sortDate) + 3 * 3600e3);
    if (end > now) return d;
  }
  return first;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function autoView(plan: PlanDetail | null, idle: DisplayView): { view: DisplayView; reason: string } {
  if (!plan) return { view: idle, reason: "No upcoming service" };
  const now = Date.now();
  const within = (t: PlanDetail["times"][number], before: number, after: number) =>
    now >= Date.parse(t.startsAt) - before && now <= Date.parse(t.endsAt || t.startsAt) + after;
  const reh = plan.times.find((t) => t.kind === "rehearsal" && within(t, 30 * 60e3, 0));
  if (reh) return { view: "stageplot", reason: `Rehearsal ${clock(reh.startsAt)}` };
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
    settings: { banner: stored.settings.banner, columns: stored.settings.columns, imageStyle: stored.settings.imageStyle }, service: null, tiles: [], stage: null,
    error: (e as Error).message, at: new Date().toISOString(),
  }));
  memo = { at: Date.now(), p };
  return p;
}

const imageUrl = (fileId: string) => `/api/board-out/image/${encodeURIComponent(fileId)}`;

async function build(): Promise<DisplayState> {
  const s = stored.settings;
  const api = pco();
  const plan = api ? await currentPlan(api, s.serviceTypeId).catch(() => null) : null;
  const { view, reason } = s.mode === "auto" ? autoView(plan, s.autoIdle) : { view: s.mode, reason: "Chosen in Cool Services" };

  const setup = mics.setup();
  const assignments = plan ? mics.plan(plan.id).assignments : [];
  const statuses = await micStatuses().catch(() => [] as ReceiverStatus[]);
  const roster = new Map((plan?.roster ?? []).map((m) => [m.personId, m]));

  const tiles: BoardTile[] = setup.channels
    .filter((c) => s.kinds.includes(c.kind))
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
      };
    })
    .filter((t) => !s.hideUnassigned || t.person);

  let stage: DisplayState["stage"] = null;
  if (plan) {
    const plotId = plots.forPlan(plan.id) ?? plots.list().find((p) => p.serviceTypeId === plan.serviceTypeId)?.id ?? null;
    const plot = plotId ? plots.get(plotId) : null;
    stage = {
      plot: plot ? {
        id: plot.id, name: plot.name, items: plot.items,
        background: plot.background ? { url: imageUrl(plot.background.fileId), width: plot.background.width, height: plot.background.height } : null,
      } : null,
      roster: plan.roster.filter((m) => m.status !== "D").map((m) => ({ personId: m.personId, name: m.name, positionName: m.positionName, status: m.status })),
      assignments,
      channels: setup.channels.map((c) => ({ id: c.id, label: c.label, kind: c.kind, positions: c.positions })),
    };
  }

  const now = Date.now();
  const next = plan?.times.filter((t) => t.kind === "service" && Date.parse(t.endsAt || t.startsAt) > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  return {
    view, mode: s.mode, reason, settings: { banner: s.banner, columns: s.columns, imageStyle: s.imageStyle },
    service: plan ? {
      planId: plan.id, serviceTypeId: plan.serviceTypeId, title: plan.title, serviceTypeName: plan.serviceTypeName,
      when: new Date(plan.sortDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      nextTime: next ? clock(next.startsAt) : null,
    } : null,
    tiles, stage, error: api ? null : "Open the Mic board in Cool Services once so the display can read Planning Center.",
    at: new Date().toISOString(),
  };
}

/** Files the display may show without signing in: the current plot's background and board pictures. */
export function publicImage(fileId: string): boolean {
  const s = stored.settings;
  if (Object.values(s.customImages).includes(fileId)) return true;
  return plots.list().some((p) => p.background?.fileId === fileId);
}
