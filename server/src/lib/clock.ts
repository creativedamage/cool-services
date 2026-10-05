/**
 * The production clock engine: one clock for the whole building.
 *
 * Holds the main and secondary timers, the message and the presets; runs presets on their schedule;
 * moves to the next preset when a timer ends; looks up "until service" and "Live item" times in
 * Planning Center. Every output (control page, network clock, NDI, second display) gets the state
 * through onClockChange and works out the display itself (shared/clock.ts).
 */
import crypto from "node:crypto";
import {
  DEFAULT_LABEL, DEFAULT_TIMER_COLOR, nextAt, readClock, type MessagePosition,
  type ClockOutputSettings, type ClockPreset, type ClockState, type ClockStatusView, type ClockTimerSpec, type ClockTimerState,
} from "../../../shared/clock.js";
import { pcoForUser } from "../auth/oauth.js";
import type { PcoApi } from "../pco/api.js";
import { extras } from "./db.js";

interface Stored { presets: ClockPreset[]; settings: ClockOutputSettings; state: ClockState | null; owner: { userId: string; demo: boolean } | null }
const KEY = "clock";

const defaultSettings = (): ClockOutputSettings => ({
  ndi: { enabled: false, name: "Sundays Clock", resolution: "1080p", fps: 30, transparent: false },
  screen: { enabled: false, displayId: null },
  lan: false,
  title: "MASTER TIME",
  infoHeading: "INFORMATION",
  showTimeOfDay: true,
  controlKey: crypto.randomBytes(4).toString("hex"),
});
const blankTimer = (): ClockTimerState => ({ mode: "countdown", label: "Countdown", running: false, startedAt: null, elapsedMs: 0, durationMs: 300_000, targetAt: null, overtime: true });
const blankState = (): ClockState => ({
  main: blankTimer(), secondary: null, message: "", messagePosition: "bottom", info: { title: "", subtitle: "", hidden: false }, timerColor: DEFAULT_TIMER_COLOR, blank: false, presetId: null, presetName: null, warnSec: 60, dangerSec: 15, serverNow: Date.now(), version: 1 });

function load(): Stored {
  const s = extras.get<Partial<Stored>>(KEY, {});
  const settings = { ...defaultSettings(), ...s.settings } as ClockOutputSettings;
  settings.ndi = { ...defaultSettings().ndi, ...s.settings?.ndi };
  settings.screen = { ...defaultSettings().screen, ...s.settings?.screen };
  if (!s.settings?.controlKey) extras.set(KEY, { ...s, settings });
  return { presets: s.presets ?? [], settings, state: s.state ?? null, owner: s.owner ?? null };
}
let stored = load();
// Older saved states don't have the newer fields.
let state: ClockState = { ...blankState(), ...(stored.state ?? {}) };
const persist = () => extras.set(KEY, { ...stored, state });

/* ───────────── Change notifications ───────────── */

type Listener = (s: ClockState) => void;
const listeners = new Set<Listener>();
export function onClockChange(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function changed(save = true) {
  state = { ...state, version: state.version + 1, serverNow: Date.now() };
  if (save) persist();
  for (const fn of listeners) { try { fn(state); } catch { /* a closed stream */ } }
}
export const clockState = (): ClockState => ({ ...state, serverNow: Date.now() });
export const clockPresets = () => stored.presets;
export const clockSettings = () => stored.settings;

/* ───────────── Outputs (NDI and the second display live in the Mac app) ───────────── */

let status: ClockStatusView = { ndi: { available: false, running: false, sourceName: null, connections: 0, error: "NDI output works in the Sundays Mac app." }, displays: [] };
const settingsListeners = new Set<(s: ClockOutputSettings) => void>();
/** Registered by desktop/src/main.ts. */
export const clockOutputs = {
  settings: () => stored.settings,
  onSettings: (fn: (s: ClockOutputSettings) => void) => { settingsListeners.add(fn); },
  setStatus: (patch: { ndi?: Partial<ClockStatusView["ndi"]>; displays?: ClockStatusView["displays"] }) => {
    status = { ...status, ...patch, ndi: { ...status.ndi, ...patch.ndi } };
  },
};
export const clockStatus = () => status;

export function saveClockSettings(patch: Partial<ClockOutputSettings>) {
  const cur = stored.settings;
  stored.settings = { ...cur, ...patch, ndi: { ...cur.ndi, ...patch.ndi }, screen: { ...cur.screen, ...patch.screen } };
  persist();
  for (const fn of settingsListeners) fn(stored.settings);
  changed(false); // outputs re-read showTimeOfDay / transparency
  return stored.settings;
}

export function saveClockPresets(list: ClockPreset[]) {
  stored.presets = list;
  persist();
  if (state.presetId && !list.some((p) => p.id === state.presetId)) state = { ...state, presetId: null, presetName: null };
  changed();
  return stored.presets;
}

/** Whose Planning Center access looks up service times and Live (whoever last used the clock). */
export function setClockOwner(owner: { userId: string; demo: boolean }) {
  if (stored.owner?.userId === owner.userId && stored.owner.demo === owner.demo) return;
  stored.owner = owner;
  persist();
}
const pco = (): PcoApi | null => (stored.owner ? pcoForUser(stored.owner.userId, stored.owner.demo) : null);

/* ───────────── Building timers ───────────── */

function build(spec: ClockTimerSpec & { startWhenMainEnds?: boolean }, now = Date.now()): ClockTimerState {
  const t: ClockTimerState = {
    mode: spec.mode, label: spec.label?.trim() || DEFAULT_LABEL[spec.mode], running: false, startedAt: null, elapsedMs: 0,
    durationMs: Math.max(0, (spec.durationSec ?? 300) * 1000), targetAt: null, overtime: spec.overtime ?? true,
    startWhenMainEnds: spec.startWhenMainEnds,
  };
  if (spec.mode === "totime") t.targetAt = nextAt(spec.target ?? "", now);
  if (spec.mode === "timeofday") t.running = true;
  if (spec.mode === "service" || spec.mode === "liveitem") { t.idle = "Looking it up in Planning Center…"; t.running = true; }
  return t;
}
/** Which service type a Planning Center timer follows (kept beside the state, not shown). */
const follow = { main: null as string | null, secondary: null as string | null };

function startTimer(t: ClockTimerState, now = Date.now()): ClockTimerState {
  if (t.running && t.startedAt) return t;
  if (t.mode === "countdown" || t.mode === "countup") return { ...t, running: true, startedAt: now };
  return { ...t, running: true };
}
function pauseTimer(t: ClockTimerState, now = Date.now()): ClockTimerState {
  if (!t.running || (t.mode !== "countdown" && t.mode !== "countup")) return t;
  return { ...t, running: false, elapsedMs: t.elapsedMs + (t.startedAt ? now - t.startedAt : 0), startedAt: null };
}
function resetTimer(t: ClockTimerState, spec?: ClockTimerSpec): ClockTimerState {
  if (t.mode === "countdown" || t.mode === "countup") return { ...t, running: false, startedAt: null, elapsedMs: 0 };
  if (t.mode === "totime" && spec?.target) return { ...t, targetAt: nextAt(spec.target, Date.now()) };
  return t;
}

/* ───────────── Actions ───────────── */

export type ClockAction =
  | { type: "start" | "pause" | "toggle" | "reset"; which?: "main" | "secondary" }
  | { type: "add"; sec: number; which?: "main" | "secondary" }
  | { type: "set"; which: "main" | "secondary"; spec: (ClockTimerSpec & { startWhenMainEnds?: boolean }) | null; start?: boolean }
  | { type: "message"; text: string }
  | { type: "blank"; on: boolean }
  | { type: "load"; presetId: string; start?: boolean }
  | { type: "next" | "prev" }
  | { type: "colors"; warnSec: number; dangerSec: number }
  | { type: "info"; title?: string; subtitle?: string; hidden?: boolean }
  | { type: "style"; timerColor?: string; messagePosition?: MessagePosition };

let mainEnded = false;
const presetById = (id: string | null) => stored.presets.find((p) => p.id === id) ?? null;

function loadPreset(p: ClockPreset, start?: boolean) {
  const now = Date.now();
  let main = build(p.main, now);
  const secondary = p.secondary ? build(p.secondary, now) : null;
  follow.main = p.main.serviceTypeId ?? null;
  follow.secondary = p.secondary?.serviceTypeId ?? null;
  if (start ?? p.autoStart) main = startTimer(main, now);
  state = {
    // A secondary countdown/stopwatch runs alongside the main one (unless it waits for the main to end).
    ...state, main, secondary: secondary && !secondary.startWhenMainEnds && main.running ? startTimer(secondary, now) : secondary,
    message: p.message, blank: false, info: { title: p.info?.title ?? "", subtitle: p.info?.subtitle ?? "", hidden: state.info.hidden },
    timerColor: p.timerColor ?? DEFAULT_TIMER_COLOR, presetId: p.id, presetName: p.name, warnSec: p.warnSec, dangerSec: p.dangerSec,
  };
  mainEnded = false;
  void refreshPco(true);
}

export function clockAct(a: ClockAction): ClockState {
  const now = Date.now();
  const which = "which" in a && a.which === "secondary" ? "secondary" : "main";
  const on = (fn: (t: ClockTimerState) => ClockTimerState) => {
    if (which === "secondary") { if (state.secondary) state = { ...state, secondary: fn(state.secondary) }; }
    else state = { ...state, main: fn(state.main) };
  };
  switch (a.type) {
    case "start": on((t) => startTimer(t, now)); break;
    case "pause": on((t) => pauseTimer(t, now)); break;
    case "toggle": on((t) => (t.running && t.startedAt ? pauseTimer(t, now) : startTimer(t, now))); break;
    case "reset": {
      const p = presetById(state.presetId);
      on((t) => resetTimer(t, which === "main" ? p?.main : p?.secondary ?? undefined));
      if (which === "main") mainEnded = false;
      break;
    }
    case "add": on((t) => {
      const ms = Math.round(a.sec * 1000);
      if (t.mode === "countdown" || t.mode === "liveitem") return { ...t, durationMs: Math.max(0, t.durationMs + ms) };
      if (t.mode === "countup") return { ...t, elapsedMs: Math.max(0, t.elapsedMs + ms) };
      if (t.targetAt != null) return { ...t, targetAt: t.targetAt + ms };
      return t;
    }); mainEnded = false; break;
    case "set": {
      if (!a.spec) { if (which === "secondary") state = { ...state, secondary: null }; break; }
      let t = build(a.spec, now);
      if (a.start) t = startTimer(t, now);
      follow[which] = a.spec.serviceTypeId ?? null;
      // A timer set by hand isn't the loaded preset any more (so its "next" doesn't kick in).
      state = which === "main" ? { ...state, main: t, presetId: null, presetName: null } : { ...state, secondary: t };
      if (which === "main") mainEnded = false;
      void refreshPco(true);
      break;
    }
    case "message": state = { ...state, message: a.text.slice(0, 200) }; break;
    case "blank": state = { ...state, blank: a.on }; break;
    case "colors": state = { ...state, warnSec: Math.max(0, a.warnSec), dangerSec: Math.max(0, a.dangerSec) }; break;
    case "info": state = { ...state, info: { title: (a.title ?? state.info.title).slice(0, 60), subtitle: (a.subtitle ?? state.info.subtitle).slice(0, 80), hidden: a.hidden ?? state.info.hidden } }; break;
    case "style": state = { ...state, timerColor: a.timerColor ?? state.timerColor, messagePosition: a.messagePosition ?? state.messagePosition }; break;
    case "load": {
      const p = presetById(a.presetId);
      if (!p) throw Object.assign(new Error("That timer isn’t saved any more."), { status: 404 });
      loadPreset(p, a.start);
      break;
    }
    case "next":
    case "prev": {
      const list = stored.presets;
      if (!list.length) break;
      const i = list.findIndex((p) => p.id === state.presetId);
      const j = i < 0 ? 0 : (i + (a.type === "next" ? 1 : -1) + list.length) % list.length; // loops end → start
      loadPreset(list[j]);
      break;
    }
  }
  changed();
  return clockState();
}

/* ───────────── Planning Center: until service, Live item ───────────── */

let pcoBusy = false;
async function serviceTarget(api: PcoApi, st: string | null): Promise<{ at: number; label: string } | null> {
  const now = Date.now();
  const plans = (await api.listUpcomingPlans(st ?? undefined)).filter((p) => Date.parse(p.sortDate) > now - 12 * 3600e3).slice(0, 4);
  let best: { at: number; label: string } | null = null;
  for (const p of plans) {
    const d = await api.getPlan(p.serviceTypeId, p.id).catch(() => null);
    for (const t of d?.times ?? []) {
      if (t.kind !== "service") continue;
      const at = Date.parse(t.startsAt);
      if (at > now && (!best || at < best.at)) best = { at, label: `${p.serviceTypeName} · ${new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` };
    }
    if (best) break; // plans come in date order
  }
  return best;
}

async function liveItem(api: PcoApi, st: string | null): Promise<{ title: string; startedAt: number; lengthMs: number } | null> {
  const now = Date.now();
  const plans = (await api.listUpcomingPlans(st ?? undefined)).filter((p) => Math.abs(Date.parse(p.sortDate) - now) < 18 * 3600e3).slice(0, 6);
  for (const p of plans) {
    const live = await api.getLive(p.serviceTypeId, p.id).catch(() => null);
    if (!live?.currentItemId) continue;
    const d = await api.getPlan(p.serviceTypeId, p.id).catch(() => null);
    const item = d?.items.find((i) => i.id === live.currentItemId);
    if (!item) continue;
    return { title: item.title, startedAt: live.currentStartedAt ? Date.parse(live.currentStartedAt) : now, lengthMs: item.lengthSec * 1000 };
  }
  return null;
}

/** Fill in service / Live item timers. Live is checked every few seconds; service times every minute. */
async function refreshPco(force = false) {
  const needs = (["main", "secondary"] as const).filter((w) => {
    const t = state[w];
    return t && (t.mode === "service" || t.mode === "liveitem");
  });
  if (!needs.length || pcoBusy) return;
  const api = pco();
  if (!api) {
    for (const w of needs) state = { ...state, [w]: { ...state[w]!, idle: "Open the Clock in Sundays once so it can read Planning Center." } };
    changed(false);
    return;
  }
  pcoBusy = true;
  let any = false;
  try {
    for (const w of needs) {
      const t = state[w]!;
      if (t.mode === "service" && (force || !t.targetAt || t.targetAt < Date.now() - 60_000 || Date.now() % 60_000 < 3500)) {
        const r = await serviceTarget(api, follow[w]).catch(() => null);
        const next: ClockTimerState = r ? { ...t, targetAt: r.at, idle: undefined, label: t.label === DEFAULT_LABEL.service || !t.label ? DEFAULT_LABEL.service : t.label } : { ...t, targetAt: null, idle: "No upcoming service" };
        if (JSON.stringify(next) !== JSON.stringify(t)) { state = { ...state, [w]: next }; any = true; }
      }
      if (t.mode === "liveitem") {
        const r = await liveItem(api, follow[w]).catch(() => null);
        const next: ClockTimerState = r
          ? { ...t, idle: undefined, running: true, label: r.title, startedAt: r.startedAt, elapsedMs: 0, durationMs: r.lengthMs }
          : { ...t, idle: "Planning Center Live isn’t running", running: false, startedAt: null };
        if (JSON.stringify(next) !== JSON.stringify(t)) { state = { ...state, [w]: next }; any = true; mainEnded = false; }
      }
    }
  } finally { pcoBusy = false; }
  if (any) changed(false);
}

/* ───────────── The tick: ends, next presets, schedules ───────────── */

let lastMinute = "";
const fired = new Set<string>();

function tick() {
  const now = Date.now();
  const r = readClock(state.main, now);
  if (r.done && !mainEnded && state.main.running) {
    mainEnded = true;
    let touched = false;
    if (state.secondary?.startWhenMainEnds && !state.secondary.running) { state = { ...state, secondary: startTimer(state.secondary, now) }; touched = true; }
    const next = presetById(presetById(state.presetId)?.nextPresetId ?? null);
    if (next) { loadPreset(next, true); touched = true; }
    if (touched) changed();
  }
  // Schedules: "Sundays 8:55 → Walk-in".
  const d = new Date(now);
  const minute = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
  if (minute !== lastMinute) {
    lastMinute = minute;
    const hhmm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    for (const p of stored.presets) {
      const s = p.schedule;
      if (!s?.enabled || !s.days.includes(d.getDay())) continue;
      const [h, m] = s.time.split(":").map(Number);
      if (`${h}:${String(m).padStart(2, "0")}` !== hhmm) continue;
      const key = `${p.id}@${minute}`;
      if (fired.has(key)) continue;
      fired.add(key);
      loadPreset(p, true);
      changed();
      console.log(`[clock] schedule started “${p.name}”`);
    }
    if (fired.size > 500) fired.clear();
  }
}

let started = false;
export function startClock() {
  if (started) return;
  started = true;
  setInterval(tick, 200);
  setInterval(() => void refreshPco(), 3000);
  void refreshPco(true);
}
