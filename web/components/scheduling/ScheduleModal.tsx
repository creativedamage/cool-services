"use client";
/**
 * Three-click scheduling: pick a service → pick a position → Schedule.
 * Used by the Kanban quick action ("bring this person into Services").
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, BellRing, CalendarCheck, CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { PlanSummary } from "@shared/types";
import { Api, planQuery, qk } from "@/lib/api";
import { usePlans } from "@/lib/plans";
import { shortDate } from "@/lib/format";
import { useUi } from "@/lib/store";
import { Avatar, Modal, Skeleton, Spinner } from "@/components/ui";

export function ScheduleModal() {
  const { scheduleFor: person, closeSchedule } = useUi();
  const qc = useQueryClient();
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const [slot, setSlot] = useState<{ teamId: string; teamName: string; positionName: string } | null>(null);
  const [notify, setNotify] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { setPlan(null); setSlot(null); setShowAll(false); }, [person?.personId]);

  const plans = usePlans({ enabled: !!person });
  const detail = useQuery({
    ...planQuery(plan?.serviceTypeId ?? "", plan?.id ?? ""),
    enabled: !!plan,
  });
  const conflicts = useQuery({
    queryKey: plan && person ? qk.conflicts(plan.id, person.personId) : ["conflicts", "none"],
    queryFn: () => Api.conflicts(plan!.serviceTypeId, plan!.id, person!.personId),
    enabled: !!plan && !!person,
  });

  const schedule = useMutation({
    mutationFn: () => Api.schedule(plan!.serviceTypeId, plan!.id, { personId: person!.personId, teamId: slot!.teamId, positionName: slot!.positionName, notify }),
    onSuccess: () => {
      toast.success(`${person!.name} scheduled`, { description: `${slot!.positionName} · ${shortDate(plan!.sortDate)}${notify ? " · request queued" : ""}` });
      qc.invalidateQueries({ queryKey: qk.plans });
      qc.invalidateQueries({ queryKey: qk.plan(plan!.serviceTypeId, plan!.id) });
      closeSchedule();
    },
    onError: (e) => toast.error("Couldn’t schedule", { description: (e as Error).message }),
  });

  const allPositions = useMemo(
    () => detail.data?.teams.flatMap((t) => t.positions.map((p) => ({ teamId: t.id, teamName: t.name, positionName: p.name }))) ?? [],
    [detail.data],
  );

  if (!person) return null;
  const blocking = conflicts.data ?? [];

  return (
    <Modal open onClose={closeSchedule} width={640}
      title={<span className="flex items-center gap-2.5"><Avatar name={person.name} src={person.avatarUrl} size={26} /> Schedule {person.name}</span>}>
      <div className="grid max-h-[70vh] grid-cols-[230px_1fr] divide-x divide-line">
        {/* 1 — service */}
        <div className="overflow-y-auto p-3">
          <div className="label px-1 pb-2">1 · Service</div>
          {plans.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="mb-1.5 h-12" />)}
          {plans.data?.map((p) => (
            <button key={p.id} onClick={() => { setPlan(p); setSlot(null); }}
              onMouseEnter={() => void qc.prefetchQuery(planQuery(p.serviceTypeId, p.id))}
              className={clsx("mb-1 w-full rounded-lg px-2.5 py-2 text-left transition",
                plan?.id === p.id ? "bg-accent-soft ring-1 ring-accent/40" : "hover:bg-hover")}>
              <div className="flex items-center justify-between text-sm font-medium">
                {shortDate(p.sortDate)}
                {p.neededCount > 0 && <span className="rounded bg-warn-soft px-1.5 text-[10px] text-warn">{p.neededCount} open</span>}
              </div>
              <div className="truncate text-xs text-ink-muted">{p.serviceTypeName} · {p.title}</div>
            </button>
          ))}
        </div>

        {/* 2 — position */}
        <div className="flex min-h-[340px] flex-col overflow-y-auto p-4">
          {!plan && <div className="m-auto text-sm text-ink-faint">Pick a service on the left</div>}
          {plan && (
            <>
              {conflicts.isLoading ? (
                <div className="mb-3 flex items-center gap-2 text-xs text-ink-muted"><Spinner size={11} /> Checking availability…</div>
              ) : blocking.length ? (
                <div className="mb-3 space-y-1 rounded-lg border border-warn/30 bg-warn-soft p-2.5 text-xs text-warn">
                  {blocking.map((c, i) => <div key={i} className="flex items-center gap-1.5"><AlertTriangle size={12} />{c.label}</div>)}
                </div>
              ) : (
                <div className="mb-3 flex items-center gap-1.5 text-xs text-ok"><CheckCircle2 size={13} /> Available — no blockouts or double-booking</div>
              )}

              <div className="label pb-2">2 · Position {detail.data?.needed.length ? "— open slots first" : ""}</div>
              {detail.isLoading && <Skeleton className="h-24" />}
              <div className="flex flex-wrap gap-1.5">
                {detail.data?.needed.map((n) => (
                  <SlotChip key={n.id} active={slot?.teamId === n.teamId && slot.positionName === n.positionName}
                    onClick={() => setSlot(n)} label={n.positionName} sub={`${n.teamName} · ${n.quantity} open`} highlight />
                ))}
              </div>
              {detail.data && (
                <button className="mt-3 self-start text-xs text-accent hover:underline" onClick={() => setShowAll((s) => !s)}>
                  {showAll ? "Hide" : "Show"} all positions
                </button>
              )}
              {showAll && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {allPositions.map((p) => (
                    <SlotChip key={`${p.teamId}-${p.positionName}`} active={slot?.teamId === p.teamId && slot.positionName === p.positionName}
                      onClick={() => setSlot(p)} label={p.positionName} sub={p.teamName} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <footer className="flex items-center gap-3 border-t border-line px-5 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-[rgb(var(--c-accent))]" />
          <BellRing size={13} /> Send scheduling request
        </label>
        <button className="btn-primary ml-auto" disabled={!plan || !slot || schedule.isPending} onClick={() => schedule.mutate()}>
          {schedule.isPending ? <Spinner /> : <CalendarCheck size={15} />}
          {slot && plan ? `${blocking.length ? "Schedule anyway" : "Schedule"} · ${slot.positionName}` : "3 · Schedule"}
        </button>
      </footer>
    </Modal>
  );
}

function SlotChip({ label, sub, active, highlight, onClick }: { label: string; sub: string; active: boolean; highlight?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={clsx("rounded-lg border px-2.5 py-1.5 text-left transition",
        active ? "border-accent bg-accent-soft" : highlight ? "border-warn/30 hover:border-warn/60" : "border-line hover:border-line-strong")}>
      <div className="text-[13px] font-medium">{label}</div>
      <div className="text-[10px] text-ink-muted">{sub}</div>
    </button>
  );
}
