"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PlanSummary } from "@shared/types";
import { Api, planQuery, qk } from "@/lib/api";
import { usePlans } from "@/lib/plans";
import { Skeleton } from "@/components/ui";
import { ResiBadge } from "@/components/resi/Resi";
import { routes } from "@/lib/routes";
import { useCampus } from "@/lib/campus";

export default function ServicesPage() {
  const plans = usePlans({ refetchInterval: 60_000 });
  const { campus, shows } = useCampus();
  const types = { data: plans.types?.filter((t) => shows(t.id)) };
  const [type, setType] = useState<string | null>(null);
  const list = (plans.data ?? []).filter((p) => (type ? p.serviceTypeId === type : shows(p.serviceTypeId)));

  return (
    <div className="overflow-y-auto p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Upcoming services{campus ? <span className="text-ink-muted"> · {campus.name}</span> : null} <ResiBadge className="ml-1 align-middle" /></h1>
      <p className="mt-1 text-sm text-ink-muted">Every plan at a glance. Open one to fill slots and handle responses.</p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {[{ id: null, name: "All" }, ...(types.data ?? [])].map((t) => (
          <button key={t.id ?? "all"} onClick={() => setType(t.id)}
            className={clsx("rounded-full border px-3 py-1 text-xs transition",
              type === t.id ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-ink-muted hover:text-ink-soft")}>
            {t.name}
          </button>
        ))}
        {type && (
          <Link href={routes.matrix(type)} className="ml-2 rounded-full border border-line px-3 py-1 text-xs text-ink-soft hover:border-accent/50 hover:text-accent">
            Matrix view →
          </Link>
        )}
      </div>

      <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
        {plans.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}
        {list.map((p) => <PlanTile key={p.id} p={p} />)}
        {!plans.isLoading && plans.pending.filter((t) => (type ? t.id === type : shows(t.id))).map((t) => (
          <div key={t.id} className="panel grid h-[104px] place-items-center text-xs text-ink-faint">Loading {t.name}…</div>
        ))}
      </div>
    </div>
  );
}

function PlanTile({ p }: { p: PlanSummary }) {
  const qc = useQueryClient();
  const d = new Date(p.sortDate);
  // The list arrives without roster counts (that's what makes it fast); each tile fills its own in.
  // Only for tiles on screen, so a long list doesn't queue dozens of roster downloads.
  const ref = useRef<HTMLAnchorElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) setSeen(true); }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const counts = useQuery({
    queryKey: qk.counts(p.id),
    queryFn: () => Api.planCounts(p.serviceTypeId, p.id),
    enabled: p.confirmedCount === null && seen,
    staleTime: 60_000,
  });
  const c = p.confirmedCount !== null
    ? { confirmed: p.confirmedCount, unconfirmed: p.unconfirmedCount ?? 0, declined: p.declinedCount ?? 0 }
    : counts.data;
  const total = (c ? c.confirmed + c.unconfirmed : 0) + p.neededCount;
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <Link ref={ref} href={routes.plan(p.serviceTypeId, p.id)}
      onMouseEnter={() => void qc.prefetchQuery(planQuery(p.serviceTypeId, p.id))}
      className="panel group flex gap-4 p-4 transition hover:border-line-strong hover:bg-raised">
      <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-line bg-canvas py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-accent">{d.toLocaleDateString("en-US", { weekday: "short" })}</div>
        <div className="text-2xl font-semibold leading-none tabular-nums">{d.getDate()}</div>
        <div className="text-[10px] uppercase text-ink-muted">{d.toLocaleDateString("en-US", { month: "short" })}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-ink-muted">{p.serviceTypeName}</div>
        <div className="truncate font-semibold group-hover:text-accent-strong">{p.title}</div>
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-hover">
          {c && <div className="bg-ok transition-all" style={{ width: pct(c.confirmed) }} />}
          {c && <div className="bg-warn transition-all" style={{ width: pct(c.unconfirmed) }} />}
        </div>
        <div className="mt-2 flex gap-3 text-[11px] tabular-nums">
          {c ? (
            <>
              <span className="text-ok">{c.confirmed} confirmed</span>
              <span className="text-warn">{c.unconfirmed} pending</span>
              {c.declined > 0 && <span className="text-bad">{c.declined} declined</span>}
            </>
          ) : (
            <span className="text-ink-faint">Loading team…</span>
          )}
          <span className={clsx("ml-auto", p.neededCount ? "text-ink-soft" : "text-ink-faint")}>{p.neededCount} open</span>
        </div>
      </div>
    </Link>
  );
}
