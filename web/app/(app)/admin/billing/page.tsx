"use client";
/** Invoices across every organization: draft this period's, send them, mark them paid. */
import clsx from "clsx";
import { FilePlus2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { fmtPrice } from "@shared/ops/billing";
import type { InvoiceRow } from "@shared/ops/types";
import { fmtDate, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, KpiRow, Loading, PageHeader, Pill, Table } from "@/components/ops/OpsUi";
import { INVOICE_TONE } from "@/components/ops/PlanBilling";
import { Spinner } from "@/components/ui";

export default function Page() { return <Suspense><Billing /></Suspense>; }

const TABS = ["", "DRAFT", "SENT", "PAID", "VOID"] as const;
const LABEL: Record<(typeof TABS)[number], string> = { "": "All", DRAFT: "Drafts", SENT: "Sent", PAID: "Paid", VOID: "Void" };

function Billing() {
  const sp = useSearchParams();
  const router = useRouter();
  const refresh = useOpsRefresh();
  const status = (sp.get("status") ?? "") as (typeof TABS)[number];
  const d = useOps<InvoiceRow[]>(`/platform/invoices${status ? `?status=${status}` : ""}`, { placeholderData: (p) => p });
  const all = useOps<InvoiceRow[]>("/platform/invoices");
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const sum = (s: string) => (all.data ?? []).filter((i) => i.status === s).reduce((t, i) => t + i.totalCents, 0);
  const set = async (id: string, s: InvoiceRow["status"]) => {
    try { await ops(`/platform/invoices/${id}`, { method: "PUT", json: { status: s } }); await refresh(); } catch (err) { toast.error((err as Error).message); }
  };
  const drafts = (d.data ?? []).filter((i) => i.status === "DRAFT");
  return (
    <>
      <PageHeader crumb="Sundays admin" title="Billing" description="Draft each period's invoices from every organization's plan, then send them. Card payments come with Stripe later." />
      <div className="space-y-5">
        <KpiRow items={[
          { value: fmtPrice(sum("DRAFT")), label: "Drafted, not sent", tone: "accent" },
          { value: fmtPrice(sum("SENT")), label: "Sent, not yet paid", tone: "warn" },
          { value: fmtPrice(sum("PAID")), label: "Paid", tone: "ok" },
        ]} />
        <Card eyebrow="Push billing out" title="Draft invoices for a period">
          <form className="flex flex-wrap items-end gap-3 p-4" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            try { const r = await ops<{ created: number; skipped: number }>("/platform/invoices/generate", { json: { period } }); toast.success(`${r.created} drafted · ${r.skipped} skipped`); await refresh(); }
            catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
          }}>
            <label><span className="label mb-1.5 block">Period</span><input type="month" className="input" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
            <button className="btn-primary" disabled={busy}>{busy ? <Spinner /> : <FilePlus2 size={15} />} Draft invoices</button>
            <p className="basis-full text-[11px] text-ink-faint">One per active or past-due organization, using its plan, add-ons and discounts. Full licenses, trials, $0 bills and ones already drafted for the period are skipped. Yearly orgs get one per year.</p>
          </form>
        </Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line p-0.5">
            {TABS.map((t) => <button key={t || "all"} onClick={() => router.replace(`/admin/billing${t ? `?status=${t}` : ""}`)} className={clsx("rounded-md px-3 py-1.5 text-xs font-medium", status === t ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-hover")}>{LABEL[t]}</button>)}
          </div>
          {drafts.length > 0 && <button className="btn-outline ml-auto text-xs" onClick={async () => { for (const i of drafts) await ops(`/platform/invoices/${i.id}`, { method: "PUT", json: { status: "SENT" } }); toast.success(`${drafts.length} sent`); await refresh(); }}>Send all {drafts.length} drafts</button>}
        </div>
        <ErrorBox error={d.error} />
        {!d.data ? (!d.error && <Loading />) : (
          <Card>
            <Table min={820} head={<tr><th>Invoice</th><th>Organization</th><th>Period</th><th>Due</th><th className="text-right">Total</th><th>Status</th><th /></tr>}>
              {d.data.map((i) => (
                <tr key={i.id}>
                  <td className="font-mono text-xs text-ink-muted">{i.number}</td>
                  <td><Link href={`/admin/orgs/view?id=${i.orgId}`} className="font-medium hover:text-accent">{i.orgName}</Link></td>
                  <td className="text-ink-soft">{i.period ?? "—"}</td>
                  <td className="text-xs text-ink-muted">{i.dueAt ? fmtDate(i.dueAt) : "—"}</td>
                  <td className="text-right font-mono">{fmtPrice(i.totalCents)}{i.discountCents > 0 && <div className="text-[10px] text-ok">−{fmtPrice(i.discountCents)}</div>}</td>
                  <td><Pill tone={INVOICE_TONE[i.status]}>{i.status.toLowerCase()}</Pill></td>
                  <td className="whitespace-nowrap text-right text-xs">
                    {i.status === "DRAFT" && <button className="text-accent hover:underline" onClick={() => set(i.id, "SENT")}>Send</button>}
                    {i.status === "SENT" && <button className="text-accent hover:underline" onClick={() => set(i.id, "PAID")}>Mark paid</button>}
                    {(i.status === "DRAFT" || i.status === "SENT") && <button className="ml-3 text-ink-muted hover:underline" onClick={() => set(i.id, "VOID")}>Void</button>}
                  </td>
                </tr>
              ))}
              {!d.data.length && <tr><td colSpan={7} className="py-10 text-center text-ink-faint">No invoices here.</td></tr>}
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
