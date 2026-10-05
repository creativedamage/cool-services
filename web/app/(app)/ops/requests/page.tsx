"use client";
import { Plus } from "lucide-react";
import Link from "next/link";
import { OPEN_STATUSES } from "@shared/ops/workflow";
import type { RequestRow } from "@shared/ops/types";
import { useOps } from "@/lib/ops";
import { Card, ErrorBox, Loading, PageHeader } from "@/components/ops/OpsUi";
import { RequestTable } from "@/components/ops/RequestTable";

export default function MyRequests() {
  const rows = useOps<RequestRow[]>("/requests/mine", { refetchInterval: 60_000 });
  const open = (rows.data ?? []).filter((r) => OPEN_STATUSES.includes(r.status));
  const closed = (rows.data ?? []).filter((r) => !OPEN_STATUSES.includes(r.status));
  return (
    <>
      <PageHeader crumb="Requests" title="My requests" description="Everything you've asked for: technology, supplies and building repairs."
        actions={<Link href="/ops/requests/new" className="btn-primary"><Plus size={15} /> New request</Link>} />
      <ErrorBox error={rows.error} />
      {!rows.data ? <Loading /> : (
        <div className="space-y-5">
          <Card eyebrow="In progress" title={`Open (${open.length})`}><RequestTable rows={open} show={{ campus: true, assignee: true }} empty="Nothing open. Need something? Start a new request." /></Card>
          <Card eyebrow="History" title="Closed"><RequestTable rows={closed} show={{ campus: true }} empty="No closed requests yet." /></Card>
        </div>
      )}
    </>
  );
}
