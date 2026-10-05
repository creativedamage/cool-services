"use client";
/** Sundays | Operations overview: what's waiting, my requests, AVL numbers and recent activity. */
import { ArrowRight, Boxes, ClipboardList, Inbox, Plus, Search } from "lucide-react";
import Link from "next/link";
import type { OverviewData } from "@shared/ops/types";
import { fmtDate, fmtDateTime, money0, useOps } from "@/lib/ops";
import { useOpsUser } from "@/components/ops/context";
import { Card, Empty, ErrorBox, KpiRow, Loading, PageHeader, QuoteStatusBadge } from "@/components/ops/OpsUi";
import { RequestTable } from "@/components/ops/RequestTable";

export default function OpsOverview() {
  const me = useOpsUser();
  const d = useOps<OverviewData>("/overview", { refetchInterval: 60_000 });
  const first = me.user.name.split(" ")[0];
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const avl = me.nav.avl;
  return (
    <>
      <PageHeader crumb={me.org.name ?? "Sundays | Operations"} title={`${hello}, ${first}`}
        description={avl ? "Requests, sales, margin and purchasing in one place." : "Ask for technology, supplies and building repairs, and follow them through."}
        actions={<>
          <Link href="/ops/requests/new" className={avl ? "btn-outline" : "btn-primary"}><Plus size={15} /> New request</Link>
          {avl && <Link href="/ops/quotes?new=1" className="btn-primary"><Plus size={15} /> New quote</Link>}
        </>} />
      <ErrorBox error={d.error} />
      {!d.data ? <Loading /> : (
        <div className="space-y-5">
          {d.data.queue ? (
            <KpiRow items={[
              { value: String(d.data.queue.approval), label: "Waiting on approval", href: "/ops/work?tab=approval", tone: d.data.queue.approval ? "warn" : "accent" },
              { value: String(d.data.queue.open), label: "Open in my queue", href: "/ops/work" },
              { value: String(d.data.queue.urgent), label: "High / urgent open", href: "/ops/work", tone: d.data.queue.urgent ? "bad" : "accent" },
              { value: String(d.data.queue.doneWeek), label: "Completed this week", href: "/ops/work?tab=done", tone: "ok" },
            ]} />
          ) : !d.data.avl && (
            <KpiRow items={[
              { value: String(d.data.mine.open.length), label: "My open requests", href: "/ops/requests" },
              { value: String(d.data.mine.awaiting), label: "Awaiting approval", href: "/ops/requests", tone: "warn" },
              { value: String(d.data.mine.completed30), label: "Completed (30 days)", href: "/ops/requests", tone: "ok" },
            ]} />
          )}
          {d.data.avl && (
            <KpiRow items={[
              { value: money0(d.data.avl.pipelineCents), label: "Active pipeline", href: "/ops/quotes" },
              { value: money0(d.data.avl.acceptedCents), label: "Accepted sales (this year)", href: "/ops/quotes?status=ACCEPTED", tone: "ok" },
              { value: money0(d.data.avl.profitCents), label: "Projected gross profit", tone: "ok" },
              { value: money0(d.data.avl.openPurchasingCents), label: "Open purchasing" },
            ]} />
          )}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-5">
              <Card eyebrow="My requests" title="Open requests" action={<Link href="/ops/requests" className="text-xs text-accent hover:underline">View all →</Link>}>
                <RequestTable rows={d.data.mine.open} show={{ campus: true, assignee: true }} empty="You have no open requests." />
              </Card>
              {d.data.avl && (
                <Card eyebrow="AVL" title="Recent quotes" action={<Link href="/ops/quotes" className="text-xs text-accent hover:underline">View all →</Link>}>
                  {d.data.avl.recent.length ? (
                    <ul className="divide-y divide-line">
                      {d.data.avl.recent.map((q) => (
                        <li key={q.id}>
                          <Link href={`/ops/quotes/view?id=${q.id}`} className="flex items-center gap-4 px-4 py-3 text-sm hover:bg-hover/40">
                            <span className="w-28 shrink-0 font-mono text-xs text-ink-muted">{q.number.replace(/^\w+-/, "")}</span>
                            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{q.customer.name}</span><span className="block truncate text-[11px] text-ink-faint">{q.title}</span></span>
                            <span className="hidden text-xs text-ink-muted sm:block">{fmtDate(q.sentAt ?? q.createdAt)}</span>
                            <QuoteStatusBadge status={q.status} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : <Empty>No quotes yet.</Empty>}
                </Card>
              )}
            </div>
            <div className="space-y-5">
              <div className="grid gap-3">
                <Quick href="/ops/requests/new" icon={Plus} title="Make a request" sub="Technology, supplies, or a building repair" />
                {me.nav.handlesRequests && <Quick href="/ops/work" icon={ClipboardList} title="Open the work queue" sub="Requests routed to your teams" />}
                {avl ? <Quick href="/ops/catalog" icon={Search} title="Find equipment pricing" sub="Every vendor price list" /> : <Quick href="/ops/requests" icon={Inbox} title="Track my requests" sub="Status and comments" />}
                {avl && <Quick href="/ops/vendors" icon={Boxes} title="Vendors & price lists" sub="Import a new price sheet" />}
              </div>
              <Card eyebrow="Accountability" title="Recent activity" action={d.data.canViewActivity ? <Link href="/ops/settings/activity" className="text-xs text-accent hover:underline">All →</Link> : undefined}>
                {d.data.activity.length ? (
                  <ul className="divide-y divide-line">
                    {d.data.activity.map((a) => (
                      <li key={a.id} className="px-4 py-2.5 text-[13px]">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium">{a.href ? <Link href={a.href} className="hover:text-accent">{a.action}</Link> : a.action}</span>
                          <span className="shrink-0 text-[11px] text-ink-faint">{fmtDateTime(a.createdAt)}</span>
                        </div>
                        <div className="truncate text-[11px] text-ink-muted">{a.actorName ?? a.actorLabel ?? "System"}{a.detail && ` · ${a.detail}`}</div>
                      </li>
                    ))}
                  </ul>
                ) : <Empty>No activity yet.</Empty>}
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Quick({ href, icon: Icon, title, sub }: { href: string; icon: typeof Plus; title: string; sub: string }) {
  return (
    <Link href={href} className="panel group flex items-center gap-3 px-4 py-3 transition hover:border-line-strong hover:bg-hover/40">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Icon size={17} /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-ink-muted">{sub}</span></span>
      <ArrowRight size={15} className="text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  );
}
