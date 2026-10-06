"use client";
import { useModule } from "@/components/ops/context";
import { TypeIcon } from "./TypeIcon";
import Link from "next/link";
import { KIND_LABEL } from "@shared/ops/workflow";
import type { RequestRow } from "@shared/ops/types";
import { fmtAge } from "@/lib/ops";
import { Empty, PriorityBadge, RequestStatusBadge, Table } from "./OpsUi";

export function RequestTable({ rows, show: wanted = {}, empty = "No requests." }: { rows: RequestRow[]; show?: { requester?: boolean; campus?: boolean; assignee?: boolean }; empty?: string }) {
  const multi = useModule("campuses");
  const show = { ...wanted, campus: wanted.campus && multi };
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <Table min={820} head={
      <tr>
        <th className="w-28">Request</th><th>Summary</th>
        {show.requester && <th>Requested by</th>}{show.campus && <th>Campus</th>}
        <th>Priority</th>{show.assignee && <th>Assignee</th>}<th>Status</th><th className="text-right">Age</th>
      </tr>
    }>
      {rows.map((r) => (
        <tr key={r.id}>
          <td className="font-mono text-xs text-ink-muted"><Link href={`/ops/requests/view?id=${r.id}`} className="hover:text-accent">{r.number.replace(/^\w+-R-/, "R-")}</Link></td>
          <td>
            <Link href={`/ops/requests/view?id=${r.id}`} className="font-medium hover:text-accent">{r.title}</Link>
            <div className="text-[11px] text-ink-faint">
              <TypeIcon plain icon={r.category.icon} kind={r.category.kind} size={13} className="mr-1.5 text-ink-muted" />
              {r.category.name} · {KIND_LABEL[r.category.kind]}{r.location && ` · ${r.location}`}
            </div>
          </td>
          {show.requester && <td className="text-ink-soft">{r.requester.name}</td>}
          {show.campus && <td className="text-ink-soft">{r.campus.name}</td>}
          <td><PriorityBadge priority={r.priority} /></td>
          {show.assignee && <td className="text-ink-soft">{r.assignee?.name ?? <span className="text-ink-faint">—</span>}</td>}
          <td><RequestStatusBadge status={r.status} /></td>
          <td className="text-right font-mono text-xs text-ink-faint">{fmtAge(r.createdAt)}</td>
        </tr>
      ))}
    </Table>
  );
}
