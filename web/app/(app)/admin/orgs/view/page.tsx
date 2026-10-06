"use client";
/**
 * One organization, from the super-admin side: status, plan, modules (add-ons or turned off),
 * full license, discounts, notes, its people and invoices. The price updates as you change things.
 */
import clsx from "clsx";
import { ArrowRight, FilePlus2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { computeBill, effectiveModules, fmtPrice, ORG_STATUS_LABEL, ORG_TYPES, type Interval, type ModuleKey, type OrgStatus, type OrgType } from "@shared/ops/billing";
import type { AdminOrg, AdminOrgPage, InvoiceRow } from "@shared/ops/types";
import { fmtDate, fmtDateTime, ops, useOps, useOpsRefresh, useSwitchOrg } from "@/lib/ops";
import { Card, Check, ErrorBox, Field, Loading, MoneyInput, PageHeader, PercentInput, Pill } from "@/components/ops/OpsUi";
import { BillLines, INVOICE_TONE } from "@/components/ops/PlanBilling";
import { STATUS_TONE } from "@/components/ops/AdminUi";
import { Spinner } from "@/components/ui";

export default function Page() { return <Suspense><OrgView /></Suspense>; }

function OrgView() {
  const id = useSearchParams().get("id") ?? "";
  const d = useOps<AdminOrgPage>(id ? `/platform/orgs/${id}` : null);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  return <Editor key={JSON.stringify(d.data.org)} data={d.data} />;
}

const dateInput = (v: string | null) => (v ? v.slice(0, 10) : "");

function Editor({ data }: { data: AdminOrgPage }) {
  const refresh = useOpsRefresh();
  const switchOrg = useSwitchOrg();
  const [o, setO] = useState<AdminOrg>(data.org);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<AdminOrg>) => setO({ ...o, ...p });
  const plan = data.plans.find((p) => p.id === o.planId) ?? null;
  const enabled = effectiveModules(o, plan);
  const bill = useMemo(() => computeBill(o, plan, data.modules, data.churchDiscountBps), [o, plan, data.modules, data.churchDiscountBps]);

  const override = (k: ModuleKey, v: "plan" | "on" | "off") => {
    const m = { ...o.moduleOverrides };
    if (v === "plan") delete m[k]; else m[k] = v === "on";
    set({ moduleOverrides: m });
  };
  const save = async () => {
    setBusy(true);
    try {
      await ops(`/platform/orgs/${o.id}`, { method: "PUT", json: { ...o, billingEmail: o.billingEmail ?? "", trialEndsAt: o.trialEndsAt || null, discountEndsAt: o.discountEndsAt || null } });
      toast.success("Saved"); await refresh();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader crumb="Sundays admin / Organizations" title={o.name ?? "Untitled"}
        description={<span className="flex flex-wrap items-center gap-2"><Pill tone={STATUS_TONE[data.org.status]}>{ORG_STATUS_LABEL[data.org.status]}</Pill>{data.org.fullLicense && <Pill tone="violet">Full license</Pill>}<span className="text-ink-muted">since {fmtDate(o.createdAt)}</span></span>}
        actions={<>
          <button className="btn-outline" onClick={() => void switchOrg(o.id, "/ops")}>Open in Operations <ArrowRight size={14} /></button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner />}Save changes</button>
        </>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card eyebrow="Account" title="Organization">
            <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Name"><input className="input" value={o.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Type" hint={o.orgType === "CHURCH" ? `Churches get ${data.churchDiscountBps / 100}% off` : undefined}>
                <select className="input" value={o.orgType} onChange={(e) => set({ orgType: e.target.value as OrgType })}>{ORG_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
              </Field>
              <Field label="Status">
                <select className="input" value={o.status} onChange={(e) => set({ status: e.target.value as OrgStatus })}>
                  {(Object.keys(ORG_STATUS_LABEL) as OrgStatus[]).map((s) => <option key={s} value={s}>{ORG_STATUS_LABEL[s]}</option>)}
                </select>
              </Field>
              <Field label="Trial ends"><input type="date" className="input" value={dateInput(o.trialEndsAt)} onChange={(e) => set({ trialEndsAt: e.target.value || null })} /></Field>
              <Field label="Billing email"><input type="email" className="input" value={o.billingEmail ?? ""} onChange={(e) => set({ billingEmail: e.target.value || null })} /></Field>
              <Field label="Billed"><select className="input" value={o.billingInterval} onChange={(e) => set({ billingInterval: e.target.value as Interval })}><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></select></Field>
            </div>
            {(o.status === "SUSPENDED" || o.status === "CANCELLED") && <p className="mx-4 mb-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">Its people can't sign in to it while it's {ORG_STATUS_LABEL[o.status].toLowerCase()}. Their data stays.</p>}
          </Card>

          <Card eyebrow="License" title="Plan & modules">
            <div className="space-y-4 p-4">
              <div className={clsx("flex items-start gap-3 rounded-lg border p-3", o.fullLicense ? "border-accent/60 bg-accent-soft" : "border-line")}>
                <Check label={<span className="font-medium">Full license</span>} hint="Every module, no charge. Overrides the plan and discounts." checked={o.fullLicense} onChange={(v) => set({ fullLicense: v })} />
              </div>
              <Field label="Plan">
                <select className="input" disabled={o.fullLicense} value={o.planId ?? ""} onChange={(e) => set({ planId: e.target.value || null })}>
                  <option value="">No plan</option>
                  {data.plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {fmtPrice(p.priceMonthlyCents)}/mo{!p.active ? " (inactive)" : !p.public ? " (private)" : ""}</option>)}
                </select>
              </Field>
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-hover/50 text-left text-[11px] uppercase tracking-wider text-ink-muted [&_th]:px-3 [&_th]:py-2"><tr><th>Module</th><th>In plan</th><th>For this org</th><th className="text-right">Add-on</th></tr></thead>
                  <tbody className="divide-y divide-line [&_td]:px-3 [&_td]:py-2">
                    {data.modules.map((m) => {
                      const inPlan = !!plan?.modules.includes(m.key);
                      const ov = o.moduleOverrides[m.key];
                      return (
                        <tr key={m.key} className={clsx(!enabled.includes(m.key) && "text-ink-faint")}>
                          <td><span className="font-medium">{m.name}</span></td>
                          <td>{inPlan ? "✓" : "—"}</td>
                          <td>
                            <select className="input w-auto py-1 text-xs" disabled={o.fullLicense} value={ov === undefined ? "plan" : ov ? "on" : "off"} onChange={(e) => override(m.key, e.target.value as "plan" | "on" | "off")}>
                              <option value="plan">As the plan ({inPlan ? "on" : "off"})</option><option value="on">{inPlan ? "On" : "Add on"}</option><option value="off">Turn off</option>
                            </select>
                          </td>
                          <td className="text-right font-mono text-xs">{!inPlan && ov === true ? fmtPrice(o.billingInterval === "YEARLY" ? m.priceYearlyCents : m.priceMonthlyCents) : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          <Card eyebrow="Pricing" title="Discounts">
            <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2 lg:col-span-4">
                <Check label={`Church discount (${data.churchDiscountBps / 100}%)`} hint={o.orgType === "CHURCH" ? "Applied automatically to churches. Untick to leave it off for this one." : "Only applies when the type is Church."}
                  checked={o.churchDiscount} disabled={o.orgType !== "CHURCH"} onChange={(v) => set({ churchDiscount: v })} />
              </div>
              <Field label="Extra % off"><PercentInput bps={o.discountBps} onChange={(discountBps) => set({ discountBps })} /></Field>
              <Field label="Extra $ off each period"><MoneyInput cents={o.discountCents} onChange={(c) => set({ discountCents: c ?? 0 })} /></Field>
              <Field label="Extra discount until" hint="Blank = no end"><input type="date" className="input" value={dateInput(o.discountEndsAt)} onChange={(e) => set({ discountEndsAt: e.target.value || null })} /></Field>
              <Field label="Why"><input className="input" value={o.discountNote ?? ""} onChange={(e) => set({ discountNote: e.target.value || null })} placeholder="e.g. Founding church" /></Field>
            </div>
          </Card>

          <Card eyebrow="Only super admins see this" title="Notes">
            <div className="p-4"><textarea rows={4} className="input" value={o.adminNotes ?? ""} onChange={(e) => set({ adminNotes: e.target.value || null })} /></div>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card eyebrow={o.billingInterval === "YEARLY" ? "Each year" : "Each month"} title="They pay">
            <div className="p-4"><BillLines lines={bill.lines} total={bill.totalCents} interval={bill.interval} /></div>
            <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">Updates as you edit. Save to apply.</p>
          </Card>
          <Invoices orgId={o.id} invoices={data.invoices} bill={bill} />
          <Card eyebrow="People" title={`${data.members.length} ${data.members.length === 1 ? "person" : "people"}`}>
            <ul className="max-h-80 divide-y divide-line overflow-y-auto text-sm">
              {data.members.map((m) => (
                <li key={m.id} className="px-4 py-2">
                  <div className="flex items-center gap-2"><span className="font-medium">{m.name}</span>{m.role === "ADMIN" && <Pill tone="accent">admin</Pill>}{m.pending && <Pill tone="warn">pending</Pill>}{!m.registered && <Pill tone="muted">invited</Pill>}</div>
                  <div className="text-xs text-ink-muted">{m.email}{m.lastLoginAt && ` · ${fmtDateTime(m.lastLoginAt)}`}</div>
                </li>
              ))}
              {!data.members.length && <li className="px-4 py-6 text-center text-ink-faint">Nobody yet.</li>}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Invoices({ orgId, invoices, bill }: { orgId: string; invoices: InvoiceRow[]; bill: ReturnType<typeof computeBill> }) {
  const refresh = useOpsRefresh();
  const [busy, setBusy] = useState(false);
  const status = async (id: string, s: InvoiceRow["status"]) => {
    try { await ops(`/platform/invoices/${id}`, { method: "PUT", json: { status: s } }); toast.success(`Marked ${s.toLowerCase()}`); await refresh(); } catch (err) { toast.error((err as Error).message); }
  };
  const draft = async () => {
    setBusy(true);
    const period = new Date().toISOString().slice(0, 7);
    try {
      await ops("/platform/invoices", { json: { orgId, period, description: `Sundays · ${period}`, lines: bill.lines.map((l) => ({ label: l.label, amountCents: l.amountCents })), dueAt: new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10) } });
      toast.success("Invoice drafted"); await refresh();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card eyebrow="Billing" title="Invoices" action={<button className="btn-ghost text-xs" disabled={busy || bill.totalCents <= 0} onClick={draft} title={bill.totalCents <= 0 ? "Nothing to bill" : "Draft an invoice for this month"}><FilePlus2 size={13} /> Draft</button>}>
      {invoices.length ? (
        <ul className="divide-y divide-line text-sm">
          {invoices.map((i) => (
            <li key={i.id} className="px-4 py-2.5">
              <div className="flex items-center gap-2"><span className="font-mono text-xs text-ink-muted">{i.number}</span><span className="ml-auto font-mono">{fmtPrice(i.totalCents)}</span><Pill tone={INVOICE_TONE[i.status]}>{i.status.toLowerCase()}</Pill></div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {i.status === "DRAFT" && <button className="text-accent hover:underline" onClick={() => status(i.id, "SENT")}>Send</button>}
                {i.status === "SENT" && <button className="text-accent hover:underline" onClick={() => status(i.id, "PAID")}>Mark paid</button>}
                {i.status !== "VOID" && i.status !== "PAID" && <button className="text-ink-muted hover:underline" onClick={() => status(i.id, "VOID")}>Void</button>}
                <span className="ml-auto text-ink-faint">{i.period ?? fmtDate(i.createdAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="px-4 py-6 text-center text-sm text-ink-faint">No invoices yet.</p>}
    </Card>
  );
}
