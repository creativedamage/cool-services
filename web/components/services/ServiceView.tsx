"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { planQuery } from "@/lib/api";
import { usePlans } from "@/lib/plans";
import { clock } from "@/lib/format";
import { Skeleton } from "@/components/ui";
import { RosterPanel, type RosterFilter } from "./RosterPanel";
import { RunSheet } from "./RunSheet";
import { SongKeys } from "./SongKeys";
import { MicPanel } from "./MicPanel";
import { PlanTabs } from "./PlanTabs";
import { routes } from "@/lib/routes";

export function ServiceView({ serviceTypeId, planId }: { serviceTypeId: string; planId: string }) {
  const qc = useQueryClient();
  const plan = useQuery({
    ...planQuery(serviceTypeId, planId),
    refetchInterval: 20_000, // pick up accepts/declines coming in from volunteers
  });
  const plans = usePlans();
  const [filter, setFilter] = useState<RosterFilter>("all");

  const siblings = (plans.data ?? []).filter((x) => x.serviceTypeId === serviceTypeId);
  const idx = siblings.findIndex((x) => x.id === planId);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  // Once this plan is on screen, quietly load the next/previous ones so ◀ ▶ feel instant.
  const loaded = Boolean(plan.data);
  useEffect(() => {
    if (!loaded) return;
    for (const s of [next, prev]) if (s) void qc.prefetchQuery(planQuery(s.serviceTypeId, s.id));
  }, [loaded, next?.id, prev?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan.data) {
    // Show what we already know (date + title from the list) while the details arrive.
    const known = plans.data?.find((x) => x.id === planId);
    return (
      <div className="h-full overflow-y-auto">
        <section className="border-b border-line px-8 pb-6 pt-12">
          {known ? (
            <>
              <div className="text-sm font-medium text-accent">
                {new Date(known.sortDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">{known.title}</h1>
              <div className="mt-2 text-sm text-ink-muted">{known.serviceTypeName} · loading team and run sheet…</div>
            </>
          ) : (
            <Skeleton className="h-24 max-w-xl" />
          )}
        </section>
        {plan.error ? (
          <div className="p-8 text-sm text-bad">Couldn’t load this service. <button className="underline" onClick={() => plan.refetch()}>Retry</button></div>
        ) : (
          <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_440px]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
        )}
      </div>
    );
  }
  const p = plan.data;

  const filled = p.confirmedCount + p.unconfirmedCount;
  const total = filled + p.neededCount;
  const pct = total ? Math.round((p.confirmedCount / total) * 100) : 0;
  const d = new Date(p.sortDate);

  return (
    <div className="h-full overflow-y-auto">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_280px_at_10%_-20%,rgba(79,156,255,0.18),transparent),radial-gradient(600px_240px_at_90%_0%,rgba(167,139,250,0.12),transparent)]" />
        <div className="relative px-8 pb-6 pt-5">
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <Link href="/services" className="hover:text-ink-soft">Services</Link>
            <span>/</span>
            <span>{p.serviceTypeName}</span>
            <Link href={routes.matrix(serviceTypeId)} className="ml-2 rounded-md border border-line px-2 py-0.5 hover:border-line-strong hover:text-ink-soft">Matrix</Link>
            <div className="ml-auto mr-28 flex gap-1">
              <NavBtn href={prev && routes.plan(serviceTypeId, prev.id)}><ChevronLeft size={15} /></NavBtn>
              <NavBtn href={next && routes.plan(serviceTypeId, next.id)}><ChevronRight size={15} /></NavBtn>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-8">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-accent">
                {d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">{p.title}</h1>
              {p.seriesTitle && p.seriesTitle !== p.title && <div className="mt-1 text-sm text-ink-muted">Series · {p.seriesTitle}</div>}
              <div className="mt-4"><PlanTabs st={serviceTypeId} plan={planId} active="plan" /></div>
              <div className="mt-3 flex flex-wrap gap-2">
                {p.times.map((t) => (
                  <span key={t.id} className={clsx("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
                    t.kind === "service" ? "border-accent/30 bg-accent-soft text-accent" : "border-line bg-surface text-ink-soft")}>
                    <Clock size={12} /> {t.kind === "service" ? clock(t.startsAt) : `${t.name || t.kind} · ${clock(t.startsAt)}`}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-6">
              <Ring pct={pct} />
              <div className="flex gap-1">
                <Kpi n={p.confirmedCount} label="Confirmed" cls="text-ok" onClick={() => setFilter("all")} />
                <Kpi n={p.unconfirmedCount} label="Pending" cls="text-warn" onClick={() => setFilter("U")} />
                <Kpi n={p.declinedCount} label="Declined" cls="text-bad" onClick={() => setFilter("D")} />
                <Kpi n={p.neededCount} label="Open" cls="text-ink" onClick={() => setFilter("open")} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Song keys (Tuning) ── */}
      <SongKeys plan={p} />

      {/* ── Mics & packs ── */}
      <MicPanel plan={p} />

      {/* ── Body ── */}
      <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <RosterPanel plan={p} filter={filter} setFilter={setFilter} />
        <RunSheet plan={p} />
      </div>
    </div>
  );
}

function NavBtn({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <Link href={href} className="btn-outline p-1.5">{children}</Link>
  ) : (
    <span className="btn-outline pointer-events-none p-1.5 opacity-30">{children}</span>
  );
}

function Kpi({ n, label, cls, onClick }: { n: number; label: string; cls: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-w-[64px] flex-col items-center rounded-lg px-2 py-1 text-center transition hover:bg-hover/60">
      <span className={clsx("text-xl font-semibold leading-tight tabular-nums", cls)}>{n}</span>
      <span className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</span>
    </button>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 30, c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-[76px] w-[76px] place-items-center">
      <svg width="76" height="76" className="-rotate-90">
        <circle cx="38" cy="38" r={r} stroke="rgb(var(--c-line))" strokeWidth="7" fill="none" />
        <circle cx="38" cy="38" r={r} stroke="rgb(var(--c-ok))" strokeWidth="7" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} className="transition-all duration-500" />
      </svg>
      <div className="absolute text-center leading-none">
        <div className="text-base font-semibold tabular-nums">{pct}%</div>
        <div className="mt-0.5 text-[9px] uppercase tracking-wider text-ink-muted">ready</div>
      </div>
    </div>
  );
}
