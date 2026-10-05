"use client";
/** Sundays | AVL overview: pipeline, recent quotes and AVL activity. */
import { Boxes, Briefcase, Plus, Search } from "lucide-react";
import Link from "next/link";
import type { AvlOverview } from "@shared/ops/types";
import { fmtDate, money0, useOps } from "@/lib/ops";
import { useOpsUser } from "@/components/ops/context";
import { ActivityList, Card, Empty, ErrorBox, KpiRow, Loading, PageHeader, Quick, QuoteStatusBadge } from "@/components/ops/OpsUi";

export default function AvlHome() {
  const me = useOpsUser();
  const d = useOps<AvlOverview>("/avl/overview", { refetchInterval: 60_000 });
  const first = me.user.name.split(" ")[0];
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return (
    <>
      <PageHeader crumb={me.nav.avlName ?? "Sundays | AVL"} title={`${hello}, ${first}`}
        description="Clients, quotes, margin and purchasing for the churches you work with."
        actions={<>
          <Link href="/avl/clients?new=1" className="btn-outline"><Plus size={15} /> New client</Link>
          <Link href="/avl/quotes?new=1" className="btn-primary"><Plus size={15} /> New quote</Link>
        </>} />
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <div className="space-y-5">
          <KpiRow items={[
            { value: money0(d.data.pipelineCents), label: "Active pipeline", href: "/avl/quotes" },
            { value: money0(d.data.acceptedCents), label: "Accepted sales (this year)", href: "/avl/quotes?status=ACCEPTED", tone: "ok" },
            { value: money0(d.data.profitCents), label: "Projected gross profit", tone: "ok" },
            { value: String(d.data.clients), label: "Active clients", href: "/avl/clients" },
          ]} />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card eyebrow="Quotes" title="Recent quotes" action={<Link href="/avl/quotes" className="text-xs text-accent hover:underline">View all →</Link>}>
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
            </Card>
            <div className="space-y-5">
              <div className="grid gap-3">
                <Quick href="/avl/clients" icon={Briefcase} title="Clients" sub="The churches you work with" />
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
