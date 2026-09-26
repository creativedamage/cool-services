"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import clsx from "clsx";
import { BellRing, CalendarDays, LayoutDashboard, MessageCircle, MonitorUp, KanbanSquare, LayoutTemplate, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Api, planQuery, qk } from "@/lib/api";
import { prefetchPlans, usePlans } from "@/lib/plans";
import { useUpdates } from "@/components/settings/UpdatesSettings";
import { Avatar, Badge } from "@/components/ui";
import { ScheduleModal } from "@/components/scheduling/ScheduleModal";
import { Logo } from "@/components/Logo";
import { routes } from "@/lib/routes";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Suspense><Shell>{children}</Shell></Suspense>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const search = useSearchParams();
  const activeWf = search.get("id");
  const qc = useQueryClient();
  // Warm up the upcoming-services list right away, so "Schedule in Services" opens instantly.
  useEffect(() => { void prefetchPlans(qc); }, [qc]);
  const me = useQuery({ queryKey: qk.me, queryFn: Api.me, staleTime: Infinity });
  const workflows = useQuery({ queryKey: qk.workflows, queryFn: Api.workflows, refetchInterval: 60_000 });
  const updates = useUpdates();
  const version = useQuery({ queryKey: ["version"], queryFn: Api.version, staleTime: Infinity }).data;

  const nav = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/workflows", label: "Workflows", icon: KanbanSquare },
    { href: "/services", label: "Services", icon: CalendarDays },
    { href: "/stage-plots", label: "Stage plots", icon: LayoutTemplate },
    { href: "/propresenter", label: "ProPresenter", icon: MonitorUp },
    { href: "/chat", label: "Chat", icon: MessageCircle },
    { href: "/paging", label: "Parent paging", icon: BellRing },
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-line bg-surface/60">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <Logo size={30} />
          <div className="leading-tight">
            <div className="text-sm font-semibold">Cool Services</div>
            <div className="truncate text-[11px] text-ink-muted">{me.data?.orgName ?? "\u00a0"}</div>
          </div>
        </div>

        <nav className="space-y-0.5 px-2">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition",
                path.startsWith(href) ? "bg-hover text-ink" : "text-ink-muted hover:bg-hover/60 hover:text-ink-soft")}>
              <Icon size={16} /> {label}
            </Link>
          ))}
        </nav>

        {path.startsWith("/services") ? (
          <ServicesNav activeSt={search.get("st")} activePlan={search.get("plan")} tab={path} />
        ) : path.startsWith("/stage-plots") ? (
          <StagePlotsNav activeId={search.get("id")} />
        ) : path.startsWith("/paging") ? (
          <PagingNav />
        ) : path.startsWith("/chat") || path.startsWith("/propresenter") || path.startsWith("/dashboard") ? (
          <div className="flex-1" />
        ) : path.startsWith("/settings") ? (
          <SettingsNav />
        ) : (
          <>
            <div className="label mt-6 px-4 pb-2">Workflows</div>
            <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
              {workflows.data?.map((w) => (
                <Link key={w.id} href={routes.board(w.id)}
                  className={clsx("flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] transition",
                    path === "/workflows/board" && activeWf === w.id ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-hover/60")}>
                  <span className="truncate">{w.name}</span>
                  <span className="flex items-center gap-1">
                    {w.overdueCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-bad" title={`${w.overdueCount} overdue`} />}
                    <span className="text-[11px] tabular-nums text-ink-muted">{w.readyCount}</span>
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}

        {me.data && (
          <div className="flex items-center gap-2.5 border-t border-line p-3">
            <Avatar name={me.data.name} src={me.data.avatarUrl} size={30} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13px] font-medium">{me.data.name}</div>
              <div className="truncate text-[11px] text-ink-muted">{me.data.orgName}{version ? ` · v${version}` : ""}</div>
              {updates.data?.state === "available" && (
                <Link href="/settings#updates" className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20">
                  Update to {updates.data.latest?.version}
                </Link>
              )}
            </div>
            <Link href="/settings" className={clsx("btn-ghost p-1.5", path === "/settings" && "text-accent")} title="Settings"><Settings size={15} /></Link>
            <button className="btn-ghost p-1.5" title="Sign out"
              onClick={async () => { await Api.logout(); window.location.href = "/"; }}>
              <LogOut size={15} />
            </button>
          </div>
        )}
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col">
        {me.data?.demo && (
          <div className="absolute right-4 top-3.5 z-10"><Badge tone="violet">Demo data</Badge></div>
        )}
        {children}
      </main>

      <ScheduleModal />
    </div>
  );
}

/**
 * Sidebar while in Services: the upcoming services for the service type you're looking at
 * (or every service type, grouped, on the Services overview).
 */
function ServicesNav({ activeSt, activePlan, tab }: { activeSt: string | null; activePlan: string | null; tab: string }) {
  // Stay on the same tab (Plan / Check-ins / Stage plot) when switching services.
  const link = tab === "/services/checkins" ? routes.checkins : tab === "/services/stage" ? routes.planStage : routes.plan;
  const qc = useQueryClient();
  const plans = usePlans();
  const list = plans.data ?? [];
  // In Planning Center's service type order; each type appears as soon as its plans arrive.
  const types = (plans.types ?? []).map((t) => [t.id, t.name] as [string, string])
    .filter(([id]) => (!activeSt || id === activeSt) && list.some((p) => p.serviceTypeId === id));
  const waiting = plans.pending.filter((t) => !activeSt || t.id === activeSt);

  return (
    <div className="mt-6 flex-1 overflow-y-auto px-2">
      {plans.types === undefined && <div className="px-2 text-xs text-ink-faint">Loading services…</div>}
      {types.map(([stId, stName]) => (
        <div key={stId} className="mb-4">
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <span className="label truncate">{stName}</span>
            <Link href={routes.matrix(stId)} title="Several weeks side by side"
              className={clsx("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium transition", tab === "/services/matrix" && activeSt === stId ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-hover hover:text-ink-soft")}>
              Matrix
            </Link>
          </div>
          <div className="space-y-0.5">
            {list.filter((p) => p.serviceTypeId === stId).map((p) => {
              const d = new Date(p.sortDate);
              const active = p.id === activePlan;
              return (
                <Link key={p.id} href={link(p.serviceTypeId, p.id)}
                  onMouseEnter={() => void qc.prefetchQuery(planQuery(p.serviceTypeId, p.id))}
                  className={clsx("flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition",
                    active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-hover/60")}>
                  <span className={clsx("w-9 shrink-0 text-center leading-tight", active ? "text-accent" : "text-ink-muted")}>
                    <span className="block text-[9px] font-semibold uppercase tracking-wider">{d.toLocaleDateString("en-US", { month: "short" })}</span>
                    <span className="block text-sm font-semibold tabular-nums">{d.getDate()}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{p.title}</span>
                    <span className="block text-[10px] text-ink-faint">
                      {d.toLocaleDateString("en-US", { weekday: "short" })}{p.neededCount ? ` · ${p.neededCount} open` : ""}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {waiting.length > 0 && (
        <div className="mb-4 px-2 text-[11px] text-ink-faint">Loading {waiting.map((t) => t.name).join(", ")}…</div>
      )}
      {activeSt && (
        <Link href="/services" className="block px-2 text-[11px] text-ink-muted hover:text-accent">All service types →</Link>
      )}
    </div>
  );
}

/** Sidebar on Stage plots: every plot, with the one being edited highlighted. */
function StagePlotsNav({ activeId }: { activeId: string | null }) {
  const plots = useQuery({ queryKey: qk.plots, queryFn: Api.plots });
  const plans = usePlans();
  const typeName = (id: string | null) => (plans.data ?? []).find((p) => p.serviceTypeId === id)?.serviceTypeName;
  return (
    <>
      <div className="label mt-6 px-4 pb-2">Stage plots</div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {plots.isLoading && <div className="px-2 text-xs text-ink-faint">Loading…</div>}
        {plots.data?.length === 0 && <div className="px-2 text-xs text-ink-faint">No stage plots yet.</div>}
        {plots.data?.map((p) => (
          <Link key={p.id} href={routes.stagePlot(p.id)}
            className={clsx("block rounded-lg px-2.5 py-1.5 transition", activeId === p.id ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-hover/60")}>
            <span className="block truncate text-[13px]">{p.name}</span>
            <span className="block truncate text-[10px] text-ink-faint">{p.serviceTypeId ? `Default for ${typeName(p.serviceTypeId) ?? "a service type"}` : "Not a default"}</span>
          </Link>
        ))}
        <Link href="/stage-plots" className="block px-2.5 pt-2 text-[11px] text-ink-muted hover:text-accent">All stage plots →</Link>
      </div>
    </>
  );
}

/** Sidebar on Parent paging: what's on screen, and today's pages. */
function PagingNav() {
  const status = useQuery({ queryKey: qk.pagingStatus, queryFn: Api.pagingStatus, refetchInterval: (q) => (q.state.data?.onScreenUntil ? 1000 : 4000) });
  const s = status.data;
  return (
    <>
      <div className="label mt-6 px-4 pb-2">Paged today</div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {s?.current && s.onScreenUntil && (
          <div className="mb-2 rounded-lg border border-warn/30 bg-warn-soft px-2.5 py-1.5 text-[12px] text-warn">
            On screen: <b className="font-mono">{s.current.code}</b>
          </div>
        )}
        {s && s.recent.length === 0 && <div className="px-2 text-xs text-ink-faint">Nothing paged yet today.</div>}
        {s?.recent.map((e) => (
          <div key={e.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-ink-soft">
            <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", e.ok ? "bg-ok" : "bg-bad")} />
            <span className="font-mono">{e.code}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">{e.childName ?? e.by}</span>
            <span className="text-[10px] tabular-nums text-ink-faint">{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          </div>
        ))}
        <Link href="/settings#paging" className="block px-2.5 pt-2 text-[11px] text-ink-muted hover:text-accent">Paging settings →</Link>
      </div>
    </>
  );
}

/** Sidebar on Settings: jump to a section. */
function SettingsNav() {
  const sections: [string, string][] = [
    ["appearance", "Appearance"], ["logo", "Logo"], ["start", "When Cool Services opens"], ["updates", "Updates"], ["ndi", "Stage plot over NDI"],
    ["waves", "Waves SuperRack"], ["smaart", "Smaart (SPL)"], ["paging", "ProPresenter & paging"], ["ipads", "Kids & Nursery iPads"], ["pro-computers", "ProPresenter computers"],
  ];
  return (
    <>
      <div className="label mt-6 px-4 pb-2">Settings</div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {sections.map(([id, label]) => (
          <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-soft transition hover:bg-hover/60">
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
