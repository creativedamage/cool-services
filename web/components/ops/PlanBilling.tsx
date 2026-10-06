"use client";
/** An organization's plan, modules, price and invoices (Settings → Organization & billing). */
import clsx from "clsx";
import { Check, Lock } from "lucide-react";
import { fmtPrice, ORG_STATUS_LABEL } from "@shared/ops/billing";
import type { InvoiceRow, OrgBillingView } from "@shared/ops/types";
import { fmtDate, useOps } from "@/lib/ops";
import { Card, ErrorBox, Loading, Pill } from "./OpsUi";

export const INVOICE_TONE = { DRAFT: "muted", SENT: "warn", PAID: "ok", VOID: "muted" } as const;

export function BillLines({ lines, total, interval }: { lines: { label: string; amountCents: number }[]; total: number; interval: string }) {
  return (
    <dl className="text-sm">
      {lines.map((l, i) => (
        <div key={i} className="flex justify-between gap-4 py-1"><dt className={clsx(l.amountCents < 0 ? "text-ok" : "text-ink-soft")}>{l.label}</dt><dd className="tabular-nums">{l.amountCents < 0 ? `−${fmtPrice(-l.amountCents)}` : fmtPrice(l.amountCents)}</dd></div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t border-line pt-2 font-semibold"><dt>Total</dt><dd className="tabular-nums">{fmtPrice(total)} <span className="text-xs font-normal text-ink-muted">/ {interval === "YEARLY" ? "year" : "month"}</span></dd></div>
    </dl>
  );
}

export function InvoiceList({ rows, showOrg }: { rows: InvoiceRow[]; showOrg?: boolean }) {
  if (!rows.length) return <p className="px-4 py-6 text-center text-sm text-ink-faint">No invoices yet.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {rows.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <span className="font-mono text-xs text-ink-muted">{i.number}</span>
          <span className="min-w-0 flex-1 truncate">{showOrg && i.orgName ? <b className="font-medium">{i.orgName} · </b> : null}{i.description}</span>
          <span className="text-xs text-ink-muted">{i.dueAt ? `Due ${fmtDate(i.dueAt)}` : fmtDate(i.createdAt)}</span>
          <span className="w-20 text-right font-mono">{fmtPrice(i.totalCents)}</span>
          <Pill tone={INVOICE_TONE[i.status]}>{i.status.toLowerCase()}</Pill>
        </li>
      ))}
    </ul>
  );
}

export function PlanBilling() {
  const d = useOps<OrgBillingView>("/billing");
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const { org, plan, modules, enabled, bill, invoices, members } = d.data;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card eyebrow="Plan" title={org.fullLicense ? "Full license" : plan?.name ?? "No plan"}
        action={<Pill tone={org.status === "ACTIVE" ? "ok" : org.status === "TRIAL" ? "accent" : "bad"}>{ORG_STATUS_LABEL[org.status]}</Pill>}>
        <div className="space-y-4 p-4">
          {org.status === "TRIAL" && org.trialEndsAt && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">Free trial until {fmtDate(org.trialEndsAt)}.</p>}
          {plan?.tagline && !org.fullLicense && <p className="text-sm text-ink-muted">{plan.tagline}</p>}
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {modules.map((m) => {
              const on = enabled.includes(m.key);
              return (
                <li key={m.key} className={clsx("flex items-start gap-2", !on && "text-ink-faint")}>
                  {on ? <Check size={14} className="mt-0.5 shrink-0 text-accent" /> : <Lock size={13} className="mt-0.5 shrink-0" />}
                  <span>{m.name}{!on && m.priceMonthlyCents > 0 && <span className="text-[11px]"> · add-on {fmtPrice(m.priceMonthlyCents)}/mo</span>}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-ink-faint">{members} {members === 1 ? "person" : "people"}{plan?.maxUsers ? ` of ${plan.maxUsers}` : ""}. To change your plan or add modules, contact Sundays.</p>
        </div>
      </Card>
      <Card eyebrow="Billing" title="What you pay">
        <div className="p-4"><BillLines lines={bill.lines} total={bill.totalCents} interval={bill.interval} /></div>
        <div className="border-t border-line"><div className="label px-4 pt-3">Invoices</div><InvoiceList rows={invoices} /></div>
      </Card>
    </div>
  );
}
