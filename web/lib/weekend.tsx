"use client";
/**
 * The weekend Sundays works on, everywhere (sidebar → Weekend). The Dashboard, Mic board, Clock,
 * Tuning strip, FOH companion and the start-up view all use that weekend's service; nothing moves
 * on to the next weekend by itself.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarRange } from "lucide-react";
import { toast } from "sonner";
import type { PlanSummary, WeekendView } from "@shared/types";
import { Api, qk } from "@/lib/api";

export const weekendQuery = { queryKey: qk.weekend, queryFn: Api.weekend, staleTime: 60_000, refetchInterval: 5 * 60_000 };
export const useWeekend = () => useQuery(weekendQuery);

const day = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const short = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "This weekend · Oct 10–11", "Next weekend · Oct 17–18", "Oct 24–25". */
export function weekendLabel(sunday: string, opts: { relative?: boolean } = {}) {
  const sun = day(sunday);
  const sat = new Date(sun); sat.setDate(sun.getDate() - 1);
  const span = sat.getMonth() === sun.getMonth()
    ? `${short(sat)}–${sun.getDate()}` : `${short(sat)} – ${short(sun)}`;
  if (opts.relative === false) return span;
  const now = new Date();
  const thisSun = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((7 - now.getDay()) % 7));
  const weeks = Math.round((sun.getTime() - thisSun.getTime()) / (7 * 864e5));
  return weeks === 0 ? `This weekend · ${span}` : weeks === 1 ? `Next weekend · ${span}` : weeks < 0 ? `${span} (past)` : span;
}

/**
 * The service the app follows for a service type (or the Dashboard's "Your service", or any type):
 * in the picked weekend, the first one that isn't over yet, else the weekend's last.
 */
const onWeekendDay = (p: PlanSummary) => [0, 6].includes(new Date(p.sortDate).getDay());

export function pickWeekendService(w: WeekendView | undefined, serviceTypeId?: string | null): PlanSummary | undefined {
  let list = (w?.plans ?? []).filter((p) => !serviceTypeId || p.serviceTypeId === serviceTypeId);
  // Any type: the Saturday/Sunday services first (a midweek one only if that's all there is).
  if (!serviceTypeId && list.some(onWeekendDay)) list = list.filter(onWeekendDay);
  const cutoff = Date.now() - 4 * 3600e3;
  return list.find((p) => Date.parse(p.sortDate) > cutoff) ?? list[list.length - 1];
}

export function useSetWeekend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: Api.setWeekend,
    // Everything that shows a service follows the new weekend.
    onSuccess: (w) => { qc.setQueryData(qk.weekend, w); void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "weekend" }); },
    onError: (e) => toast.error("Couldn’t change the weekend", { description: (e as Error).message }),
  });
}

/** Sidebar: the weekend everything uses. */
export function WeekendPicker({ className }: { className?: string }) {
  const w = useWeekend();
  const set = useSetWeekend();
  const v = w.data;
  const none = v && !v.sunday;
  return (
    <div className={clsx("px-3 pb-2", className)}>
      <label className={clsx("flex items-center gap-2 rounded-lg border px-2 py-1.5",
        none ? "border-warn/60 bg-warn-soft" : v?.over ? "border-warn/40" : "border-line")} title="The weekend Sundays works on everywhere: Dashboard, Mic board, Clock, Tuning strip and FOH companion">
        <CalendarRange size={14} className={none ? "text-warn" : "text-accent"} />
        <select className="min-w-0 flex-1 cursor-pointer bg-transparent text-xs font-medium text-ink outline-none" aria-label="Weekend"
          value={v?.sunday ?? ""} disabled={!v || set.isPending} onChange={(e) => set.mutate(e.target.value || null)}>
          {!v?.sunday && <option value="">Pick a weekend…</option>}
          {v?.options.map((o) => (
            <option key={o.sunday} value={o.sunday}>{weekendLabel(o.sunday)}{o.count ? "" : " · no services"}</option>
          ))}
        </select>
      </label>
      {none && <p className="mt-1 px-1 text-[10px] leading-snug text-warn">Pick the weekend you’re working on. The Dashboard, Mic board, Clock and Tuning strip use it.</p>}
      {v?.over && <p className="mt-1 px-1 text-[10px] leading-snug text-warn">That weekend is over. Pick the next one when you’re ready.</p>}
    </div>
  );
}
