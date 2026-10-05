"use client";
/** Sundays | Operations overview: what's waiting, my requests and recent activity. */
import { ClipboardList, Inbox, Plus, Tags } from "lucide-react";
import Link from "next/link";
import type { OverviewData } from "@shared/ops/types";
import { useOps } from "@/lib/ops";
import { useOpsUser } from "@/components/ops/context";
import { ActivityList, Card, ErrorBox, KpiRow, Loading, PageHeader, Quick } from "@/components/ops/OpsUi";
import { RequestTable } from "@/components/ops/RequestTable";

export default function OpsOverview() {
  const me = useOpsUser();
  const d = useOps<OverviewData>("/overview", { refetchInterval: 60_000 });
  const first = me.user.name.split(" ")[0];
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return (
    <>
      <PageHeader crumb={me.org.name ?? "Sundays | Operations"} title={`${hello}, ${first}`}
        description="Ask for technology, supplies and building repairs, and follow them through."
        actions={<Link href="/ops/requests/new" className="btn-primary"><Plus size={15} /> New request</Link>} />
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <div className="space-y-5">
          {d.data.queue ? (
            <KpiRow items={[
              { value: String(d.data.queue.approval), label: "Waiting on approval", href: "/ops/work?tab=approval", tone: d.data.queue.approval ? "warn" : "accent" },
              { value: String(d.data.queue.open), label: "Open in my queue", href: "/ops/work" },
              { value: String(d.data.queue.urgent), label: "High / urgent open", href: "/ops/work", tone: d.data.queue.urgent ? "bad" : "accent" },
              { value: String(d.data.queue.doneWeek), label: "Completed this week", href: "/ops/work?tab=done", tone: "ok" },
            ]} />
          ) : (
            <KpiRow items={[
              { value: String(d.data.mine.open.length), label: "My open requests", href: "/ops/requests" },
              { value: String(d.data.mine.awaiting), label: "Awaiting approval", href: "/ops/requests", tone: "warn" },
              { value: String(d.data.mine.completed30), label: "Completed (30 days)", href: "/ops/requests", tone: "ok" },
            ]} />
          )}
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card eyebrow="My requests" title="Open requests" action={<Link href="/ops/requests" className="text-xs text-accent hover:underline">View all →</Link>}>
              <RequestTable rows={d.data.mine.open} show={{ campus: true, assignee: true }} empty="You have no open requests." />
            </Card>
            <div className="space-y-5">
              <div className="grid gap-3">
                <Quick href="/ops/requests/new" icon={Plus} title="Make a request" sub="Technology, supplies, or a building repair" />
                {me.nav.handlesRequests && <Quick href="/ops/work" icon={ClipboardList} title="Open the work queue" sub="Requests routed to your teams" />}
                <Quick href="/ops/requests" icon={Inbox} title="Track my requests" sub="Status and comments" />
                {me.nav.manager && me.user.allCampuses && <Quick href="/ops/settings/request-types" icon={Tags} title="Request types" sub="Add or change what people can ask for" />}
              </div>
              <Card eyebrow="Accountability" title="Recent activity" action={d.data.canViewActivity ? <Link href="/ops/settings/activity" className="text-xs text-accent hover:underline">All →</Link> : undefined}>
                <ActivityList rows={d.data.activity} />
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
