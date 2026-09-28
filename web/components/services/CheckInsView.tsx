"use client";
/**
 * Who's checked in for this service (Planning Center Check-Ins), refreshed every 10 seconds.
 * New arrivals flash green. Grouped by room.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { LogOut, Search, UserCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CheckInRow } from "@shared/types";
import { Api, ApiError, qk } from "@/lib/api";
import { usePlans } from "@/lib/plans";
import { clock } from "@/lib/format";
import { Avatar, Badge, Skeleton } from "@/components/ui";
import { PlanHeader } from "./PlanTabs";
import { PageChildButton, PagerBar, usePager } from "@/components/paging/Pager";

const KIND_TONE = { Regular: "muted", Guest: "violet", Volunteer: "accent" } as const;

export function CheckInsView({ serviceTypeId, planId }: { serviceTypeId: string; planId: string }) {
  const plans = usePlans();
  const summary = plans.data?.find((p) => p.id === planId);
  const data = useQuery({
    queryKey: qk.checkins(planId),
    queryFn: () => Api.checkins(serviceTypeId, planId),
    // Stop asking while Planning Center says no (each try would just be refused again).
    refetchInterval: (q) => (q.state.error instanceof ApiError && q.state.error.status === 403 ? false : 10_000),
    refetchIntervalInBackground: true,
    retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 2,
  });
  const pager = usePager();
  const [q, setQ] = useState("");
  const [event, setEvent] = useState<string | null>(null);
  const [hideOut, setHideOut] = useState(false);

  // Flash people who arrived since the last refresh.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!data.data) return;
    const ids = data.data.rows.map((r) => r.id);
    if (seen.current) setFresh(new Set(ids.filter((id) => !seen.current!.has(id))));
    seen.current = new Set(ids);
  }, [data.data]);

  // "Updated 4s ago" ticker
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  const rows = data.data?.rows ?? [];
  const events = [...new Set(rows.map((r) => r.event).filter(Boolean))].sort();
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (!event || r.event === event) && (!hideOut || !r.checkedOutAt)
      && (!s || r.name.toLowerCase().includes(s) || r.securityCode?.toLowerCase() === s || r.locations.some((l) => l.toLowerCase().includes(s))));
  }, [rows, q, event, hideOut]);
  const rooms = useMemo(() => {
    const m = new Map<string, CheckInRow[]>();
    for (const r of shown) {
      const room = r.locations[0] ?? r.event ?? "Other";
      m.set(room, [...(m.get(room) ?? []), r]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [shown]);

  const scoped = rows.filter((r) => !event || r.event === event);
  const count = (k: CheckInRow["kind"]) => scoped.filter((r) => r.kind === k).length;
  const out = scoped.filter((r) => r.checkedOutAt).length;
  const ago = data.dataUpdatedAt ? Math.max(0, Math.round((Date.now() - data.dataUpdatedAt) / 1000)) : null;
  const denied = data.error instanceof ApiError && data.error.status === 403 ? (data.error.data as { error?: string; message?: string; pcoSays?: string | null } | undefined) : undefined;
  const needsAccess = Boolean(denied);
  const canFixBySignIn = denied?.error !== "checkins_permission";

  return (
    <div className="h-full overflow-y-auto">
      <PlanHeader st={serviceTypeId} plan={planId} active="checkins" title={summary?.title} date={summary?.sortDate} typeName={summary?.serviceTypeName}
        right={data.data && (
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
            </span>
            Live · updated {ago === null ? "…" : ago < 2 ? "just now" : `${ago}s ago`}
          </div>
        )} />

      <div className="p-6">
        {needsAccess ? (
          <div className="panel mx-auto max-w-lg p-6 text-center">
            <UserCheck className="mx-auto text-accent" />
            <h2 className="mt-2 font-semibold">{canFixBySignIn ? "Allow Check-Ins" : "No access to Check-Ins"}</h2>
            <p className="mt-1 text-sm text-ink-muted">{denied?.message ?? "Sign in again and approve Check-Ins."}</p>
            {denied?.pcoSays && <p className="mt-2 text-[11px] text-ink-faint">Planning Center said: “{denied.pcoSays}”</p>}
            {canFixBySignIn
              ? <a href={`/api/auth/login?return=${encodeURIComponent(location.pathname + location.search)}`} className="btn-primary mt-4">Sign in again</a>
              : <button className="btn-outline mt-4" onClick={() => void data.refetch()}>Try again</button>}
          </div>
        ) : data.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>
        ) : data.error ? (
          <div className="text-sm text-bad">Couldn’t load check-ins: {(data.error as Error).message}</div>
        ) : (
          <>
            <div className="mb-4"><PagerBar pager={pager} /></div>
            <div className="flex flex-wrap gap-2">
              <Stat n={scoped.length - out} label="Here now" tone="text-ok" big />
              <Stat n={count("Regular")} label="Regulars" />
              <Stat n={count("Guest")} label="Guests" tone="text-violet" />
              <Stat n={count("Volunteer")} label="Volunteers" tone="text-accent" />
              <Stat n={out} label="Checked out" tone="text-ink-muted" />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input className="input w-64 py-1.5 pl-8" placeholder="Name, room or security code" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {events.length > 1 && [null, ...events].map((ev) => (
                <button key={ev ?? "all"} onClick={() => setEvent(ev)}
                  className={clsx("rounded-full border px-3 py-1 text-xs transition",
                    event === ev ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-ink-muted hover:text-ink-soft")}>
                  {ev ?? "All events"}
                </button>
              ))}
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted">
                <input type="checkbox" checked={hideOut} onChange={(e) => setHideOut(e.target.checked)} /> Hide checked out
              </label>
            </div>

            {rows.length === 0 ? (
              <div className="mt-10 text-center text-sm text-ink-muted">
                No one is checked in for this service yet. This page updates on its own.
                <div className="mt-1 text-xs text-ink-faint">
                  Showing check-ins from {clock(data.data!.from)} to {clock(data.data!.to)} on {new Date(data.data!.from).toLocaleDateString()}.
                </div>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {rooms.map(([room, list]) => (
                  <section key={room} className="panel overflow-hidden">
                    <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
                      <div className="text-sm font-semibold">{room}</div>
                      <span className="text-xs tabular-nums text-ink-muted">{list.filter((r) => !r.checkedOutAt).length} here</span>
                    </header>
                    <ul className="divide-y divide-line/60">
                      {list.map((r) => (
                        <li key={r.id} className={clsx("flex items-center gap-3 px-4 py-2", fresh.has(r.id) && "animate-flash", r.checkedOutAt && "opacity-50")}>
                          <Avatar name={r.name} src={r.avatarUrl} size={28} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{r.name}</div>
                            <div className="truncate text-[11px] text-ink-muted">{r.event}{r.locations.length > 1 ? ` · ${r.locations.slice(1).join(", ")}` : ""}</div>
                          </div>
                          {r.kind !== "Regular" && <Badge tone={KIND_TONE[r.kind]}>{r.kind}</Badge>}
                          {r.securityCode && <span className="rounded bg-hover px-1.5 font-mono text-[11px] text-ink-soft">{r.securityCode}</span>}
                          <PageChildButton pager={pager} row={r} />
                          <span className="w-16 text-right text-[11px] tabular-nums text-ink-muted">
                            {r.checkedOutAt ? <span className="inline-flex items-center gap-1"><LogOut size={10} />{clock(r.checkedOutAt)}</span> : clock(r.at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ n, label, tone, big }: { n: number; label: string; tone?: string; big?: boolean }) {
  return (
    <div className={clsx("panel flex min-w-[110px] flex-col items-center px-4 py-3", big && "min-w-[140px]")}>
      <span className={clsx("font-semibold tabular-nums leading-tight", big ? "text-3xl" : "text-2xl", tone)}>{n}</span>
      <span className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-muted">{label}</span>
    </div>
  );
}
