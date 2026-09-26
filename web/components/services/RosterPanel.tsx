"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, Check, GripVertical, Plus, RotateCcw, Trash2, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import type { Candidate, PlanDetail, RosterStatus, TeamMember } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { Avatar, Skeleton, Spinner, StatusPill } from "@/components/ui";

export type RosterFilter = "all" | "U" | "D" | "open";

interface Slot { teamId: string; teamName: string; positionName: string }

export function RosterPanel({ plan, filter, setFilter }: { plan: PlanDetail; filter: RosterFilter; setFilter: (f: RosterFilter) => void }) {
  const qc = useQueryClient();
  const key = qk.plan(plan.serviceTypeId, plan.id);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [shownTeams, setShownTeams] = useTeamFilter(plan.serviceTypeId);
  const [order, setOrder] = useTeamOrder(plan.serviceTypeId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const patchRoster = (fn: (r: TeamMember[]) => TeamMember[]) =>
    qc.setQueryData<PlanDetail>(key, (p) => p && { ...p, roster: fn(p.roster) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: qk.plans });
  };

  const status = useMutation({
    mutationFn: (v: { tm: TeamMember; status: RosterStatus }) => Api.setStatus(plan.serviceTypeId, plan.id, v.tm.id, v.status),
    onMutate: ({ tm, status }) => patchRoster((r) => r.map((m) => (m.id === tm.id ? { ...m, status } : m))),
    onError: (e, { tm }) => { patchRoster((r) => r.map((m) => (m.id === tm.id ? tm : m))); toast.error("Update failed", { description: (e as Error).message }); },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (tm: TeamMember) => Api.removeMember(plan.serviceTypeId, plan.id, tm.id),
    onMutate: (tm) => patchRoster((r) => r.filter((m) => m.id !== tm.id)),
    onError: (e, tm) => { patchRoster((r) => [...r, tm]); toast.error("Couldn’t remove", { description: (e as Error).message }); },
    onSuccess: (_d, tm) => toast(`${tm.name} removed from ${tm.positionName}`),
    onSettled: refresh,
  });

  // Group into teams → positions, with open slots inline.
  const teams = plan.teams
    .map((t) => {
      const members = plan.roster.filter((m) => m.teamId === t.id);
      const open = plan.needed.filter((n) => n.teamId === t.id);
      const positions = [...new Set([...members.map((m) => m.positionName), ...open.map((n) => n.positionName)])]
        .sort((a, b) => t.positions.findIndex((p) => p.name === a) - t.positions.findIndex((p) => p.name === b));
      return { team: t, members, open, positions };
    })
    .filter((g) => g.members.length || g.open.length)
    // Your order first (drag team headers to change it); teams you haven't placed keep Planning Center's order.
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(order, a.g.team.id, a.i) - rank(order, b.g.team.id, b.i))
    .map(({ g }) => g);
  const moveTeam = (id: string, beforeId: string) => {
    if (id === beforeId) return;
    const ids = teams.map((g) => g.team.id).filter((x) => x !== id);
    ids.splice(ids.indexOf(beforeId), 0, id);
    setOrder(ids);
  };
  const visible = teams.filter((g) => !shownTeams.size || shownTeams.has(g.team.id));

  const vMembers = visible.flatMap((g) => g.members);
  const counts = {
    all: vMembers.length,
    U: vMembers.filter((m) => m.status === "U").length,
    D: vMembers.filter((m) => m.status === "D").length,
    open: visible.flatMap((g) => g.open).reduce((n, x) => n + x.quantity, 0),
  };
  const toggleTeam = (id: string) => {
    const next = new Set(shownTeams);
    next.has(id) ? next.delete(id) : next.add(id);
    setShownTeams(next.size === teams.length ? new Set() : next);
  };

  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center gap-1">
        <h2 className="mr-3 text-sm font-semibold">Team roster</h2>
        {(["all", "U", "D", "open"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={clsx("rounded-md px-2.5 py-1 text-xs transition",
              filter === f ? "bg-hover text-ink" : "text-ink-muted hover:text-ink-soft")}>
            {{ all: "All", U: "Pending", D: "Declined", open: "Open slots" }[f]}
            <span className="ml-1.5 tabular-nums text-ink-faint">{counts[f]}</span>
          </button>
        ))}
      </div>

      {teams.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <TeamChip active={!shownTeams.size} onClick={() => setShownTeams(new Set())}>All teams</TeamChip>
          {teams.map(({ team, members, open }) => {
            const openN = open.reduce((n, o) => n + o.quantity, 0);
            return (
              <TeamChip key={team.id} active={shownTeams.has(team.id)} onClick={() => toggleTeam(team.id)}
                onOnly={() => setShownTeams(new Set([team.id]))}>
                {team.name}
                <span className="ml-1.5 tabular-nums opacity-60">{members.filter((m) => m.status !== "D").length}</span>
                {openN > 0 && <span className="ml-1 rounded bg-warn-soft px-1 text-[10px] text-warn">{openN} open</span>}
              </TeamChip>
            );
          })}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragEnd={(e: DragEndEvent) => { if (e.over) moveTeam(String(e.active.id), String(e.over.id)); }}>
      <div className="grid gap-3 2xl:grid-cols-2">
        {visible.map(({ team, members, open, positions }) => {
          const filledCount = members.filter((m) => m.status !== "D").length;
          const openCount = open.reduce((n, o) => n + o.quantity, 0);
          const rows = positions.flatMap((pos) => {
            const ms = members.filter((m) => m.positionName === pos)
              .filter((m) => filter === "all" || m.status === filter);
            const o = open.find((x) => x.positionName === pos);
            const openRows = filter === "all" || filter === "open"
              ? Array.from({ length: o?.quantity ?? 0 }, (_, i) => ({ slotKey: `${team.id}:${pos}:${i}`, pos }))
              : [];
            return [
              ...(filter === "open" ? [] : ms.map((m) => ({ kind: "member" as const, m }))),
              ...openRows.map((r) => ({ kind: "open" as const, ...r })),
            ];
          });
          if (!rows.length) return null;

          return (
            <TeamBox key={team.id} id={team.id} name={team.name}>{(handle) => (<>
              <header {...handle}
                title="Drag to reorder teams"
                className="group flex cursor-grab touch-none items-center justify-between border-b border-line px-4 py-2.5 active:cursor-grabbing">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <GripVertical size={14} className="-ml-2 text-ink-faint opacity-40 transition group-hover:opacity-100" />
                  {team.name}
                </div>
                <div className="flex items-center gap-2 text-[11px] tabular-nums text-ink-muted">
                  <div className="h-1 w-16 overflow-hidden rounded-full bg-hover">
                    <div className="h-full bg-ok" style={{ width: `${(filledCount / Math.max(1, filledCount + openCount)) * 100}%` }} />
                  </div>
                  {filledCount}/{filledCount + openCount}
                </div>
              </header>
              <ul className="divide-y divide-line/60">
                {rows.map((row) => {
                  if (row.kind === "member") {
                    const m = row.m;
                    const slot: Slot = { teamId: team.id, teamName: team.name, positionName: m.positionName };
                    const replaceKey = `replace:${m.id}`;
                    return (
                      <li key={m.id}>
                        <div className="group flex items-center gap-3 px-4 py-2">
                          <Avatar name={m.name} src={m.avatarUrl} size={30} />
                          <div className="min-w-0 flex-1">
                            <div className={clsx("truncate text-sm font-medium", m.status === "D" && "text-ink-muted line-through decoration-ink-faint")}>{m.name}</div>
                            <div className="truncate text-[11px] text-ink-muted">
                              {m.positionName}
                              {m.status === "D" && m.declineReason ? ` · “${m.declineReason}”` : ""}
                              {m.status === "U" && m.notifiedAt ? ` · asked ${timeAgo(m.notifiedAt)}` : ""}
                            </div>
                          </div>
                          <StatusPill status={m.status} />
                          <div className="flex w-[92px] justify-end gap-0.5 opacity-0 transition group-hover:opacity-100">
                            {m.status === "D" ? (
                              <RowBtn title="Find a replacement" tone="accent" onClick={() => setAssigning(assigning === replaceKey ? null : replaceKey)}><RotateCcw size={14} /></RowBtn>
                            ) : m.status !== "C" ? (
                              <RowBtn title="Mark confirmed" tone="ok" onClick={() => status.mutate({ tm: m, status: "C" })}><Check size={14} /></RowBtn>
                            ) : null}
                            {m.status !== "D" && <RowBtn title="Mark declined" tone="bad" onClick={() => status.mutate({ tm: m, status: "D" })}><X size={14} /></RowBtn>}
                            <RowBtn title="Remove from plan" onClick={() => remove.mutate(m)}><Trash2 size={13} /></RowBtn>
                          </div>
                        </div>
                        {assigning === replaceKey && (
                          <QuickAssign plan={plan} slot={slot} onDone={() => setAssigning(null)} />
                        )}
                      </li>
                    );
                  }
                  const slot: Slot = { teamId: team.id, teamName: team.name, positionName: row.pos };
                  const open = assigning === row.slotKey;
                  return (
                    <li key={row.slotKey}>
                      <button onClick={() => setAssigning(open ? null : row.slotKey)}
                        className={clsx("flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-hover/50", open && "bg-hover/50")}>
                        <span className="grid h-[30px] w-[30px] place-items-center rounded-full border border-dashed border-line-strong text-ink-faint">
                          <Plus size={14} />
                        </span>
                        <div className="flex-1">
                          <div className="text-sm text-ink-soft">{row.pos}</div>
                          <div className="text-[11px] text-ink-faint">Open slot</div>
                        </div>
                        <span className="flex items-center gap-1 text-xs font-medium text-accent"><UserPlus size={13} /> Fill</span>
                      </button>
                      {open && <QuickAssign plan={plan} slot={slot} onDone={() => setAssigning(null)} />}
                    </li>
                  );
                })}
              </ul>
            </>)}</TeamBox>
          );
        })}
      </div>
      </DndContext>
    </section>
  );
}

function RowBtn({ children, title, tone, onClick }: { children: React.ReactNode; title: string; tone?: "ok" | "bad" | "accent"; onClick: () => void }) {
  const tones = { ok: "hover:bg-ok-soft hover:text-ok", bad: "hover:bg-bad-soft hover:text-bad", accent: "hover:bg-accent-soft hover:text-accent" };
  return (
    <button title={title} aria-label={title} onClick={onClick}
      className={clsx("rounded-md p-1.5 text-ink-muted transition", tone ? tones[tone] : "hover:bg-hover hover:text-ink")}>
      {children}
    </button>
  );
}

/**
 * Inline one-click assign: qualified people for the position, available people first,
 * least-recently-served first, conflicts shown inline.
 */
function QuickAssign({ plan, slot, onDone }: { plan: PlanDetail; slot: Slot; onDone: () => void }) {
  const qc = useQueryClient();
  const candidates = useQuery({
    queryKey: qk.candidates(plan.id, slot.teamId, slot.positionName),
    queryFn: () => Api.candidates(plan.serviceTypeId, plan.id, slot.teamId, slot.positionName),
  });
  const schedule = useMutation({
    mutationFn: (personId: string) => Api.schedule(plan.serviceTypeId, plan.id, { personId, teamId: slot.teamId, positionName: slot.positionName, notify: true }),
    onSuccess: (tm) => {
      toast.success(`${tm.name} → ${slot.positionName}`, { description: "Scheduling request queued" });
      qc.invalidateQueries({ queryKey: qk.plan(plan.serviceTypeId, plan.id) });
      qc.invalidateQueries({ queryKey: qk.plans });
      qc.invalidateQueries({ queryKey: ["candidates", plan.id] });
      qc.invalidateQueries({ queryKey: ["conflicts", plan.id] });
      onDone();
    },
    onError: (e) => toast.error("Couldn’t schedule", { description: (e as Error).message }),
  });

  return (
    <div className="animate-fade-up border-t border-line bg-canvas/70 px-3 py-2">
      <div className="label px-1 pb-1.5">Qualified for {slot.positionName}</div>
      {candidates.isLoading && <Skeleton className="h-20" />}
      {candidates.error && (
        <div className="px-1 py-3 text-xs text-bad">
          Couldn’t load who can serve here: {(candidates.error as Error).message}{" "}
          <button className="underline" onClick={() => candidates.refetch()}>Try again</button>
        </div>
      )}
      {candidates.data?.length === 0 && <div className="px-1 py-3 text-xs text-ink-faint">No one is assigned to this position in Planning Center yet.</div>}
      <ul className="max-h-64 space-y-0.5 overflow-y-auto">
        {candidates.data?.map((c) => (
          <CandidateRow key={c.personId} plan={plan} c={c} busy={schedule.isPending}
            pending={schedule.isPending && schedule.variables === c.personId} onPick={() => schedule.mutate(c.personId)} />
        ))}
      </ul>
    </div>
  );
}

function TeamChip({ children, active, onClick, onOnly }: {
  children: React.ReactNode; active: boolean; onClick: () => void; onOnly?: () => void;
}) {
  return (
    <button onClick={onClick} onDoubleClick={onOnly}
      title={onOnly ? "Click to add/remove · double-click to show only this team" : undefined}
      className={clsx("flex items-center rounded-full border px-3 py-1 text-xs transition",
        active ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-ink-muted hover:border-line-strong hover:text-ink-soft")}>
      {children}
    </button>
  );
}

/** Which teams to show, remembered per service type on this Mac. Empty = all teams. */
function useTeamFilter(serviceTypeId: string): [Set<string>, (s: Set<string>) => void] {
  const key = `coolservices.teams.${serviceTypeId}`;
  const [shown, setShown] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(key) ?? "[]")); } catch { return new Set(); }
  });
  const update = (s: Set<string>) => {
    setShown(s);
    try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* storage unavailable */ }
  };
  return [shown, update];
}

/** One person in the Fill list. Their blockouts / other services are checked in the background. */
function CandidateRow({ plan, c, busy, pending, onPick }: {
  plan: PlanDetail; c: Candidate; busy: boolean; pending: boolean; onPick: () => void;
}) {
  const check = useQuery({
    queryKey: qk.conflicts(plan.id, c.personId),
    queryFn: () => Api.conflicts(plan.serviceTypeId, plan.id, c.personId),
    enabled: !c.checked,
    staleTime: 300_000,
  });
  const conflicts = c.checked ? c.conflicts : check.data ?? c.conflicts;
  const checking = !c.checked && check.isLoading;
  const onPlan = conflicts.some((x) => x.kind === "same_plan");
  return (
    <li>
      <button disabled={onPlan || busy} onClick={onPick}
        className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent">
        <Avatar name={c.name} src={c.avatarUrl} size={26} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{c.name}</div>
          {conflicts.length ? (
            <div className="flex items-center gap-1 truncate text-[11px] text-warn"><AlertTriangle size={11} />{conflicts[0].label}</div>
          ) : checking ? (
            <div className="text-[11px] text-ink-faint">Checking availability…</div>
          ) : (
            <div className="text-[11px] text-ok">Available{c.lastServed ? ` · last served ${timeAgo(c.lastServed)}` : ""}</div>
          )}
        </div>
        {pending ? <Spinner /> : <span className="text-xs font-medium text-accent opacity-0 group-hover:opacity-100">Schedule</span>}
      </button>
    </li>
  );
}

const rank = (order: string[], id: string, fallback: number) => {
  const i = order.indexOf(id);
  return i === -1 ? 1000 + fallback : i;
};

/** Team order you set by dragging, remembered per service type on this Mac. */
function useTeamOrder(serviceTypeId: string): [string[], (ids: string[]) => void] {
  const key = `coolservices.teamOrder.${serviceTypeId}`;
  const [order, setOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
  });
  const update = (ids: string[]) => {
    setOrder(ids);
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* storage unavailable */ }
  };
  return [order, update];
}

/** A team section you can drag by its header and drop onto another team to move it there. */
function TeamBox({ id, name, children }: {
  id: string; name: string;
  children: (handle: Record<string, unknown>) => React.ReactNode;
}) {
  const drag = useDraggable({ id });
  const drop = useDroppable({ id });
  const style = drag.transform ? { transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)`, zIndex: 20 } : undefined;
  return (
    <div ref={(el) => { drag.setNodeRef(el); drop.setNodeRef(el); }} style={style} aria-label={`${name} team`}
      className={clsx("panel overflow-hidden transition-shadow",
        drag.isDragging && "relative shadow-lift",
        drop.isOver && !drag.isDragging && "ring-2 ring-accent/60")}>
      {children({ ...drag.listeners, ...drag.attributes })}
    </div>
  );
}
