"use client";
/** Pieces shared by the admin console pages. */
import Link from "next/link";
import { fmtPrice, ORG_STATUS_LABEL, ORG_TYPES } from "@shared/ops/billing";
import type { AdminOverview } from "@shared/ops/types";
import { fmtDate } from "@/lib/ops";
import { Pill, Table } from "./OpsUi";

export const STATUS_TONE = { TRIAL: "accent", ACTIVE: "ok", PAST_DUE: "warn", SUSPENDED: "bad", CANCELLED: "muted" } as const;

export function OrgTable({ rows }: { rows: AdminOverview["recent"] }) {
  if (!rows.length) return <p className="px-4 py-10 text-center text-sm text-ink-faint">No organizations yet.</p>;
  return (
    <Table min={820} head={<tr><th>Organization</th><th>Plan</th><th>Status</th><th className="text-right">People</th><th className="text-right">Pays</th><th>Since</th></tr>}>
      {rows.map((o) => (
        <tr key={o.id}>
          <td><Link href={`/admin/orgs/view?id=${o.id}`} className="font-medium hover:text-accent">{o.name ?? "Untitled"}</Link><div className="text-[11px] text-ink-faint">{ORG_TYPES.find((t) => t.key === o.orgType)?.label}</div></td>
          <td className="text-ink-soft">{o.fullLicense ? <Pill tone="violet">Full license</Pill> : o.planName ?? "—"}</td>
          <td><Pill tone={STATUS_TONE[o.status]}>{ORG_STATUS_LABEL[o.status]}</Pill>{o.status === "TRIAL" && o.trialEndsAt && <div className="text-[11px] text-ink-faint">until {fmtDate(o.trialEndsAt)}</div>}</td>
          <td className="text-right font-mono text-ink-soft">{o.members}</td>
          <td className="text-right font-mono">{fmtPrice(o.totalCents)}<span className="text-[10px] text-ink-faint">/{o.billingInterval === "YEARLY" ? "yr" : "mo"}</span></td>
          <td className="text-xs text-ink-muted">{fmtDate(o.createdAt)}</td>
        </tr>
      ))}
    </Table>
  );
}
