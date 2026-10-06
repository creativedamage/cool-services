"use client";
/** Admin overview: how Sundays is doing. */
import Link from "next/link";
import { fmtPrice } from "@shared/ops/billing";
import type { AdminOverview } from "@shared/ops/types";
import { useOps } from "@/lib/ops";
import { Card, ErrorBox, KpiRow, Loading, PageHeader } from "@/components/ops/OpsUi";
import { OrgTable } from "@/components/ops/AdminUi";


export default function AdminHome() {
  const d = useOps<AdminOverview>("/platform/overview", { refetchInterval: 60_000 });
  return (
    <>
      <PageHeader crumb="Sundays admin" title="Overview" description="Every organization on Sundays, what they pay, and who's on a trial." />
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <div className="space-y-5">
          <KpiRow items={[
            { value: fmtPrice(d.data.mrrCents), label: "Monthly recurring revenue", tone: "ok" },
            { value: String(d.data.orgs), label: `Organizations · ${d.data.active} active`, href: "/admin/orgs" },
            { value: String(d.data.trial), label: "On a free trial", href: "/admin/orgs?status=TRIAL" },
            { value: fmtPrice(d.data.openInvoicesCents), label: "Sent, not yet paid", href: "/admin/billing?status=SENT", tone: d.data.openInvoicesCents ? "warn" : "accent" },
          ]} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="panel px-4 py-3 text-sm"><b className="text-lg tabular-nums">{d.data.people}</b> <span className="text-ink-muted">people signed in across all organizations</span></div>
            <div className="panel px-4 py-3 text-sm"><b className="text-lg tabular-nums">{d.data.fullLicense}</b> <span className="text-ink-muted">on a full license</span></div>
            <div className="panel px-4 py-3 text-sm"><b className="text-lg tabular-nums">{d.data.pastDue + d.data.suspended}</b> <span className="text-ink-muted">past due or paused</span></div>
          </div>
          <Card eyebrow="Newest" title="Organizations" action={<Link href="/admin/orgs" className="text-xs text-accent hover:underline">All →</Link>}>
            <OrgTable rows={d.data.recent} />
          </Card>
        </div>
      )}
    </>
  );
}
