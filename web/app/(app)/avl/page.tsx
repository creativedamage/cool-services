"use client";
/** Sundays | AVL overview: pipeline, open jobs, recent quotes and AVL activity (a church team: its jobs). */
import { Boxes, Briefcase, Hammer, Plus, Search } from "lucide-react";
import Link from "next/link";
import type { AvlOverview } from "@shared/ops/types";
import { fmtDate, money0, useOps } from "@/lib/ops";
import { useOpsUser } from "@/components/ops/context";
import { ActivityList, Card, Empty, ErrorBox, JobStatusBadge, KpiRow, Loading, PageHeader, Quick, QuoteStatusBadge } from "@/components/ops/OpsUi";
import type { JobRow } from "@shared/ops/jobs";

export default function AvlHome() {
  const me = useOpsUser();
  const d = useOps<AvlOverview>("/avl/overview", { refetchInterval: 60_000 });
  const first = me.user.name.split(" ")[0];
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const church = me.nav.avlChurch;
  return (
    <>
      <PageHeader crumb={me.nav.avlName ?? "Sundays | AVL"} title={`${hello}, ${first}`}
        description={church ? "Your team's projects and their budgets." : "Clients, proposals, jobs and margin for the churches you work with."}
        actions={church ? <Link href="/avl/jobs?new=1" className="btn-primary"><Plus size={15} /> New job</Link> : <>
          <Link href="/avl/clients?new=1" className="btn-outline"><Plus size={15} /> New client</Link>
          <Link href="/avl/quotes?new=1" className="btn-primary"><Plus size={15} /> New quote</Link>
        </>} />
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <div className="space-y-5">
          <KpiRow items={church ? [
            { value: String(d.data.openJobs), label: "Open jobs", href: "/avl/jobs" },
            { value: money0(d.data.openJobsCostCents), label: "Budgeted in open jobs", href: "/avl/jobs" },
          ] : [
            { value: money0(d.data.pipelineCents), label: "Active pipeline", href: "/avl/quotes" },
            { value: money0(d.data.acceptedCents), label: "Accepted sales (this year)", href: "/avl/quotes?status=ACCEPTED", tone: "ok" },
            { value: String(d.data.openJobs), label: "Open jobs", href: "/avl/jobs" },
            { value: money0(d.data.profitCents), label: "Projected gross profit", tone: "ok" },
          ]} />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-5">
            <OpenJobs jobs={d.data.jobs} total={d.data.openJobs} church={church} />
            {!church && <Card eyebrow="Quotes" title="Recent quotes" action={<Link href="/avl/quotes" className="text-xs text-accent hover:underline">View all →</Link>}>
              {d.data.recent.length ? (
                <ul className="divide-y divide-line">
                  {d.data.recent.map((q) => (
                    <li key={q.id}>
                      <Link href={`/avl/quotes/view?id=${q.id}`} className="flex items-center gap-4 px-4 py-3 text-sm hover:bg-hover/40">
                        <span className="w-28 shrink-0 font-mono text-xs text-ink-muted">{q.number.replace(/^\w+-/, "")}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{q.customer.name}</span><span className="block truncate text-[11px] text-ink-faint">{q.title}</span></span>
                        <span className="hidden text-xs text-ink-muted sm:block">{fmtDate(q.sentAt ?? q.createdAt)}</span>
                        <span className="hidden w-24 text-right font-mono text-xs sm:block">{money0(q.totalCents)}</span>
                        <QuoteStatusBadge status={q.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <Empty>No quotes yet. Add a client, then start a quote.</Empty>}
            </Card>}
            </div>
            <div className="space-y-5">
              <div className="grid gap-3">
                {!church && <Quick href="/avl/clients" icon={Briefcase} title="Clients" sub="The churches you work with" />}
                <Quick href="/avl/catalog" icon={Search} title="Find equipment pricing" sub="Every vendor price list" />
                <Quick href="/avl/vendors" icon={Boxes} title="Vendors & products" sub="Add products or import a price sheet" />
              </div>
              <Card eyebrow="AVL" title="Recent activity"><ActivityList rows={d.data.activity} /></Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function OpenJobs({ jobs, total, church }: { jobs: JobRow[]; total: number; church: boolean }) {
  return (
    <Card eyebrow="Jobs" title="Open jobs" action={<Link href="/avl/jobs" className="text-xs text-accent hover:underline">{total > jobs.length ? `All ${total} →` : "View all →"}</Link>}>
      {jobs.length ? (
        <ul className="divide-y divide-line">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link href={`/avl/jobs/view?id=${j.id}`} className="flex items-center gap-4 px-4 py-3 text-sm hover:bg-hover/40">
                <Hammer size={15} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{j.name}</span><span className="block truncate text-[11px] text-ink-faint">{[j.number, j.customer?.name, j.siteCity].filter(Boolean).join(" · ")}</span></span>
                <span className="hidden text-xs text-ink-muted sm:block">{j.startDate ? fmtDate(j.startDate + "T12:00") : ""}</span>
                <span className="hidden w-24 text-right font-mono text-xs sm:block">{money0(church ? j.costCents : j.priceCents)}</span>
                <JobStatusBadge status={j.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : <Empty>{church ? "No open jobs. Start one with New job." : "No open jobs. When a client signs a proposal, create the job from it."}</Empty>}
    </Card>
  );
}
