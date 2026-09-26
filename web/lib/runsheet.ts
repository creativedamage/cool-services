/**
 * Run sheet timing: planned clock times, actual Live times per service time, and comparing one
 * service time (or another campus's service) against another.
 */
import type { ItemTimes, PlanDetail, PlanItem } from "@shared/types";

export interface Actual { startOff: number | null; dur: number | null; running: boolean }

/** Each item's actual start (seconds after the service time began) and length, for one service time. */
export function actuals(plan: PlanDetail, times: ItemTimes | undefined, planTimeId: string | null): Map<string, Actual> {
  const out = new Map<string, Actual>();
  const pt = plan.times.find((t) => t.id === planTimeId);
  if (!times || !pt) return out;
  const t0 = Date.parse(pt.startsAt);
  for (const it of plan.items) {
    const t = times[it.id]?.[pt.id];
    if (!t?.start) continue;
    const s = Date.parse(t.start);
    out.set(it.id, { startOff: (s - t0) / 1000, dur: t.end ? (Date.parse(t.end) - s) / 1000 : null, running: !t.end });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Match items of another service to ours: same item (same plan), else same title, else the same
 * position among the non-header items.
 */
export function matchItems(ours: PlanItem[], theirs: PlanItem[], samePlan: boolean): Map<string, string> {
  const m = new Map<string, string>();
  if (samePlan) { for (const i of ours) m.set(i.id, i.id); return m; }
  const byTitle = new Map<string, PlanItem[]>();
  for (const t of theirs) byTitle.set(norm(t.title), [...(byTitle.get(norm(t.title)) ?? []), t]);
  const used = new Set<string>();
  const oursReal = ours.filter((i) => i.kind !== "header");
  const theirsReal = theirs.filter((i) => i.kind !== "header");
  oursReal.forEach((o, idx) => {
    const hit = (byTitle.get(norm(o.title)) ?? []).find((t) => !used.has(t.id)) ?? theirsReal[idx];
    if (hit && !used.has(hit.id)) { m.set(o.id, hit.id); used.add(hit.id); }
  });
  return m;
}

/** "+1:05" / "−0:32" / "0:00" */
export function delta(sec: number) {
  const s = Math.round(sec);
  const a = Math.abs(s);
  return `${s > 0 ? "+" : s < 0 ? "−" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}

export const mmssAny = (sec: number | null | undefined) => {
  if (sec == null) return "";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "4:30" or "270" → seconds. */
export function parseLength(v: string): number | null {
  const t = v.trim();
  if (!t) return 0;
  const m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+$/.test(t) ? Number(t) : null;
}
