/**
 * The weekend Sundays works on, everywhere: the Dashboard and its widgets, the Mic board and the
 * displays, the Clock's "until service" and Live item, the Tuning strip and the FOH companion,
 * and the start-up view. Someone picks it (sidebar → Weekend); nothing moves on by itself.
 *
 * A weekend is the week ending on its Sunday (Monday 00:00 through Sunday 23:59, this Mac's time),
 * so a Wednesday or Saturday service that week counts too.
 */
import type { PlanDetail, PlanSummary, WeekendOption, WeekendView } from "../../../shared/types.js";
import type { PcoApi } from "../pco/api.js";
import { extras } from "./db.js";

const KEY = "weekend";
const SHOW = 9; // this weekend and the 8 after it

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** The Sunday that ends the week (Mon–Sun) a date is in. */
export const sundayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, (7 - x.getDay()) % 7); };
export function weekRange(sunday: string): { from: Date; to: Date } {
  const sun = day(sunday);
  return { from: addDays(sun, -6), to: addDays(sun, 1) };
}

const valid = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && day(s).getDay() === 0;

/** The picked weekend's Sunday (YYYY-MM-DD), or null when none is picked yet. */
export function weekend(): string | null {
  const v = extras.get<{ sunday?: string | null }>(KEY, {}).sunday;
  return valid(v) ? v : null;
}
const listeners = new Set<() => void>();
export const onWeekendChange = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export function setWeekend(sunday: string | null) {
  if (sunday !== null && !valid(sunday)) throw Object.assign(new Error("Pick a Sunday."), { status: 400 });
  extras.set(KEY, { sunday, at: new Date().toISOString() });
  memo.clear();
  for (const fn of listeners) { try { fn(); } catch { /* a listener's problem */ } }
}

/* ── Plans ── */

const memo = new Map<string, { at: number; p: Promise<PlanSummary[]> }>();
/** Plans from a Monday on (every service type), kept for a minute. */
function plansFrom(api: PcoApi, from: string): Promise<PlanSummary[]> {
  const hit = memo.get(from);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = api.listPlansFrom(from, 14);
  p.catch(() => memo.delete(from));
  memo.set(from, { at: Date.now(), p });
  return p;
}

const inRange = (p: PlanSummary, r: { from: Date; to: Date }) => {
  const t = Date.parse(p.sortDate);
  return t >= r.from.getTime() && t < r.to.getTime();
};

/** The plans in the picked weekend (optionally of one service type), in date order. Empty when none is picked. */
export async function weekendPlans(api: PcoApi, serviceTypeId?: string | null): Promise<PlanSummary[]> {
  const sun = weekend();
  if (!sun) return [];
  const r = weekRange(sun);
  return (await plansFrom(api, ymd(r.from))).filter((p) => inRange(p, r) && (!serviceTypeId || p.serviceTypeId === serviceTypeId));
}

const onWeekendDay = (p: PlanSummary) => [0, 6].includes(new Date(p.sortDate).getDay());
/** The plans the app follows: of the service type, or with no type the Saturday/Sunday ones (a midweek one only if that's all there is). */
export async function followPlans(api: PcoApi, serviceTypeId?: string | null): Promise<PlanSummary[]> {
  const list = await weekendPlans(api, serviceTypeId);
  return !serviceTypeId && list.some(onWeekendDay) ? list.filter(onWeekendDay) : list;
}

const endOf = (d: PlanDetail) =>
  Math.max(...d.times.map((t) => Date.parse(t.endsAt || t.startsAt)).filter(Number.isFinite), Date.parse(d.sortDate) + 3 * 3600e3);

/**
 * The picked weekend's service (of a service type, or of any when none is given): the first one
 * that isn't over yet, else the weekend's last. Null when no weekend is picked or it has none.
 */
export async function weekendPlan(api: PcoApi, serviceTypeId?: string | null): Promise<PlanDetail | null> {
  const list = await followPlans(api, serviceTypeId);
  let last: PlanDetail | null = null;
  for (const p of list.slice(0, 6)) {
    const d = await api.getPlan(p.serviceTypeId, p.id).catch(() => null);
    if (!d) continue;
    if (endOf(d) > Date.now()) return d;
    last = d;
  }
  return last;
}

/** For the sidebar picker and everything in the app that shows the weekend. */
export async function weekendView(api: PcoApi | null): Promise<WeekendView> {
  const sun = weekend();
  const thisSun = sundayOf(new Date());
  const sundays: string[] = Array.from({ length: SHOW }, (_, i) => ymd(addDays(thisSun, i * 7)));
  if (sun && !sundays.includes(sun)) sundays.unshift(sun);
  const range = sun ? weekRange(sun) : null;
  const view: WeekendView = {
    sunday: sun, from: range?.from.toISOString() ?? null, to: range?.to.toISOString() ?? null,
    over: Boolean(range && range.to.getTime() <= Date.now()),
    plans: [], options: sundays.map((s) => ({ sunday: s, count: 0, serviceTypeIds: [] })), error: null,
  };
  if (!api) return view;
  try {
    const first = weekRange(sundays.slice().sort()[0]).from;
    const all = await plansFrom(api, ymd(first));
    view.options = sundays.map((s): WeekendOption => {
      const r = weekRange(s);
      const here = all.filter((p) => inRange(p, r));
      return { sunday: s, count: here.length, serviceTypeIds: [...new Set(here.map((p) => p.serviceTypeId))] };
    });
    if (range) view.plans = all.filter((p) => inRange(p, range));
  } catch (e) {
    view.error = (e as Error).message;
  }
  return view;
}
