"use client";
/**
 * Matrix: several weeks of one service type side by side. Rows are teams and positions (plus the
 * songs), columns are services, cells show who's scheduled and their status, and open slots.
 * Hover a person to see every week they're on.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, Grid3x3, Music2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { PlanDetail, TeamMember } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { routes } from "@/lib/routes";
import { Skeleton } from "@/components/ui";

const DOT = { C: "bg-ok", U: "bg-warn", D: "bg-bad" } as const;
const STATUS = { C: "Confirmed", U: "Pending", D: "Declined" } as const;

export function MatrixView({ serviceTypeId }: { serviceTypeId: string }) {
  const [weeks, setWeeks] = useState(() => { try { return Number(localStorage.getItem("coolservices.matrix.weeks")) || 6; } catch { return 6; } });
  const [past, setPast] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const m = useQuery({ queryKey: qk.matrix(serviceTypeId, weeks, past), queryFn: () => Api.matrix(serviceTypeId, weeks, past), placeholderData: (prev) => prev, refetchInterval: 60_000 });
  const setW = (n: number) => { setWeeks(n); try { localStorage.setItem("coolservices.matrix.weeks", String(n)); } catch { /* ignore */ } };

  const plans = m.data?.plans ?? [];
  const now = Date.now();

  /** Teams → positions that appear in any of these weeks, in Planning Center's team order. */
  const rows = useMemo(() => {
    const teams = new Map<string, { id: string; name: string; order: string[]; positions: Set<string> }>();
    for (const p of plans) {
      for (const t of p.teams) if (!teams.has(t.id)) teams.set(t.id, { id: t.id, name: t.name, order: t.positions.map((x) => x.name), positions: new Set() });
      const add = (teamId: string, teamName: string, pos: string) => {
        if (!teams.has(teamId)) teams.set(teamId, { id: teamId, name: teamName, order: [], positions: new Set() });
        teams.get(teamId)!.positions.add(pos);
      };
      for (const r of p.roster) add(r.teamId, r.teamName, r.positionName);
      for (const n of p.needed) add(n.teamId, n.teamName, n.positionName);
    }
    return [...teams.values()].filter((t) => t.positions.size).map((t) => ({
      ...t,
      positions: [...t.positions].sort((a, b) => (idx(t.order, a) - idx(t.order, b)) || a.localeCompare(b)),
    }));
  }, [plans]);

  const cell = (p: PlanDetail, teamId: string, pos: string) => ({
    people: p.roster.filter((r) => r.teamId === teamId && r.positionName === pos),
    open: p.needed.filter((n) => n.teamId === teamId && n.positionName === pos).reduce((s, n) => s + n.quantity, 0),
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
        <Link href="/services" className="btn-ghost p-1.5"><ChevronLeft size={16} /></Link>
        <div>
          <div className="text-[11px] text-ink-muted">{m.data?.serviceType.name ?? "…"}</div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><Grid3x3 size={18} className="text-accent" /> Matrix</h1>
        </div>
        <div className="ml-6 flex rounded-lg border border-line p-0.5 text-xs">
          {[4, 6, 8, 12].map((n) => (
            <button key={n} onClick={() => setW(n)} className={clsx("rounded-md px-2.5 py-1", weeks === n ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink-soft")}>{n} weeks</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={past > 0} onChange={(e) => setPast(e.target.checked ? 2 : 0)} /> Include last 2 weeks
        </label>
        <div className="ml-auto mr-24 flex items-center gap-3 text-[11px] text-ink-muted">
          {(["C", "U", "D"] as const).map((s) => <span key={s} className="flex items-center gap-1"><span className={clsx("h-2 w-2 rounded-full", DOT[s])} />{STATUS[s]}</span>)}
          <span className="flex items-center gap-1"><span className="h-2.5 w-4 rounded border border-dashed border-line-strong" />Open</span>
        </div>
      </header>

      {rows.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-6 py-2.5">
          {rows.map((t) => (
            <button key={t.id} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}
              className={clsx("rounded-full border px-3 py-1 text-xs transition", hidden.has(t.id) ? "border-line text-ink-faint line-through" : "border-accent/40 bg-accent-soft text-accent")}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {m.isLoading ? (
          <div className="space-y-2 p-6"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>
        ) : m.error ? (
          <div className="p-6 text-sm text-bad">Couldn’t load the matrix: {(m.error as Error).message}</div>
        ) : !plans.length ? (
          <div className="p-6 text-sm text-ink-muted">No upcoming services for this service type.</div>
        ) : (
          <table className={clsx("border-separate border-spacing-0 text-[12px] transition-opacity", m.isFetching && m.isPlaceholderData && "opacity-60")}>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 w-52 min-w-52 border-b border-r border-line bg-surface px-3 py-2 text-left align-bottom text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Position</th>
                {plans.map((p) => {
                  const d = new Date(p.sortDate);
                  const past_ = Date.parse(p.sortDate) < now - 864e5 / 2;
                  return (
                    <th key={p.id} className={clsx("sticky top-0 z-20 min-w-48 border-b border-r border-line bg-surface px-3 py-2 text-left align-bottom font-normal", past_ && "opacity-60")}>
                      <Link href={routes.plan(p.serviceTypeId, p.id)} className="group block">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-accent">{d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
                        <div className="truncate text-[13px] font-semibold text-ink group-hover:text-accent">{p.title}</div>
                        <div className="mt-1 flex gap-2 text-[10px] tabular-nums">
                          <span className="text-ok">{p.confirmedCount} ✓</span>
                          <span className="text-warn">{p.unconfirmedCount} ?</span>
                          {p.declinedCount > 0 && <span className="text-bad">{p.declinedCount} ✗</span>}
                          <span className={p.neededCount ? "text-ink-soft" : "text-ink-faint"}>{p.neededCount} open</span>
                        </div>
                      </Link>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="sticky left-0 z-10 border-b border-r border-line bg-surface px-3 py-2 font-semibold"><span className="flex items-center gap-1.5"><Music2 size={12} className="text-violet" /> Songs</span></td>
                {plans.map((p) => (
                  <td key={p.id} className="border-b border-r border-line/70 px-3 py-2 align-top">
                    {p.items.filter((i) => i.kind === "song").map((i) => (
                      <div key={i.id} className="flex items-baseline gap-1.5 leading-5">
                        {i.songKey && <span className="w-7 shrink-0 font-mono text-[11px] font-semibold text-violet">{i.songKey}</span>}
                        <span className="truncate text-ink-soft">{i.title}</span>
                      </div>
                    ))}
                  </td>
                ))}
              </tr>
              {rows.filter((t) => !hidden.has(t.id)).map((t) => (
                <TeamRows key={t.id} team={t} plans={plans} cell={cell} hover={hover} setHover={setHover} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const idx = (order: string[], name: string) => { const i = order.indexOf(name); return i === -1 ? 999 : i; };

function TeamRows({ team, plans, cell, hover, setHover }: {
  team: { id: string; name: string; positions: string[] }; plans: PlanDetail[];
  cell: (p: PlanDetail, teamId: string, pos: string) => { people: TeamMember[]; open: number };
  hover: string | null; setHover: (id: string | null) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={plans.length + 1} className="sticky left-0 border-b border-line bg-canvas px-3 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{team.name}</td>
      </tr>
      {team.positions.map((pos) => (
        <tr key={pos} className="group">
          <td className="sticky left-0 z-10 border-b border-r border-line bg-surface px-3 py-1.5 text-ink-soft group-hover:bg-raised">{pos}</td>
          {plans.map((p) => {
            const c = cell(p, team.id, pos);
            return (
              <td key={p.id} className="border-b border-r border-line/70 px-2 py-1 align-top group-hover:bg-raised/50">
                <div className="flex flex-col gap-0.5">
                  {c.people.map((r) => (
                    <span key={r.id} onMouseEnter={() => setHover(r.personId)} onMouseLeave={() => setHover(null)}
                      title={`${r.name} · ${STATUS[r.status]}${r.declineReason ? ` (${r.declineReason})` : ""}`}
                      className={clsx("flex items-center gap-1.5 truncate rounded px-1.5 py-0.5 transition",
                        hover === r.personId ? "bg-accent-soft text-accent" : "text-ink",
                        r.status === "D" && "text-ink-faint line-through")}>
                      <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", DOT[r.status])} />
                      <span className="truncate">{r.name}</span>
                    </span>
                  ))}
                  {c.open > 0 && (
                    <Link href={routes.plan(p.serviceTypeId, p.id)}
                      className="rounded border border-dashed border-line-strong px-1.5 py-0.5 text-[11px] text-ink-faint hover:border-accent/60 hover:text-accent">
                      Open{c.open > 1 ? ` ×${c.open}` : ""}
                    </Link>
                  )}
                </div>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
