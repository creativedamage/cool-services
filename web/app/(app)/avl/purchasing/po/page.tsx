"use client";
/**
 * One purchase order: its lines (each can point at a job budget line), approval by an AVL Manager,
 * emailing it to the vendor, receiving what arrives, and the bills against it.
 */
import clsx from "clsx";
import { ArrowLeft, Check, CheckCircle2, ExternalLink, PackageCheck, Plus, Receipt, RotateCcw, Search, Send, Trash2, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import type { BudgetItem } from "@shared/ops/jobs";
import { poEditable, poReceivable, poTotals, type PoLine, type PurchaseOrder } from "@shared/ops/purchasing";
import type { CatalogProduct } from "@shared/ops/types";
import { fmtDateTime, fmtMoney, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Empty, ErrorBox, Field, Loading, MoneyInput, Table } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";
import { CatalogPicker } from "@/components/avl/CatalogPicker";
import { BillPill, BudgetItemSelect, day, Facts, NoteModal, PoPill, SendModal } from "@/components/avl/purchasing/bits";

interface PoPage { po: PurchaseOrder; vendors: { id: string; name: string; repEmail: string | null }[]; jobs: { id: string; number: string; name: string }[]; budget: BudgetItem[]; canApprove: boolean; me: string }
type Draft = Pick<PurchaseOrder, "expectedDate" | "shipTo" | "notes" | "shippingCents" | "taxCents"> & { vendorId: string; jobId: string | null; lines: (Omit<PoLine, "id" | "receivedQty" | "billedQty" | "sortOrder"> & { key: string })[] };

export default function Page() { return <Suspense><PoView /></Suspense>; }

const key = () => Math.random().toString(36).slice(2, 10);
const toDraft = (po: PurchaseOrder): Draft => ({
  vendorId: po.vendor?.id ?? "", jobId: po.job?.id ?? null, expectedDate: po.expectedDate, shipTo: po.shipTo, notes: po.notes, shippingCents: po.shippingCents, taxCents: po.taxCents,
  lines: po.lines.map((l) => ({ key: l.id, budgetItemId: l.budgetItemId, productId: l.productId, sku: l.sku, name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, unitCostCents: l.unitCostCents })),
});

function PoView() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const refresh = useOpsRefresh();
  const d = useOps<PoPage>(id ? `/pos/${id}` : null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"send" | "reject" | "receive" | "catalog" | null>(null);
  const po = d.data?.po;
  useEffect(() => { if (po && !dirty) setDraft(toDraft(po)); }, [po, dirty]);
  if (!d.data || !draft) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const p = d.data.po;
  const editable = poEditable(p.status);
  const t = poTotals(draft.lines, draft.shippingCents, draft.taxCents);
  const set = (x: Partial<Draft>) => { setDraft({ ...draft, ...x }); setDirty(true); };
  const setLine = (k: string, x: Partial<Draft["lines"][number]>) => set({ lines: draft.lines.map((l) => (l.key === k ? { ...l, ...x } : l)) });
  const back = p.job ? `/avl/jobs/view?id=${p.job.id}&tab=purchasing` : "/avl/purchasing";

  async function save(quiet = false) {
    setBusy("save");
    try {
      await ops(`/pos/${id}`, { method: "PUT", json: { ...draft, lines: draft!.lines.map(({ key: _k, ...l }) => l) } });
      setDirty(false); await d.refetch(); if (!quiet) toast.success("Saved");
      return true;
    } catch (e) { toast.error((e as Error).message); return false; } finally { setBusy(null); }
  }
  async function event(event: string, extra: Record<string, unknown> = {}, done?: string) {
    if (dirty && !(await save(true))) return;
    setBusy(event);
    try { await ops(`/pos/${id}/events`, { json: { event, ...extra } }); await d.refetch(); void refresh(); if (done) toast.success(done); setModal(null); }
    catch (e) { if (event === "SEND" || event === "REJECT") throw e; toast.error((e as Error).message); }
    finally { setBusy(null); }
  }
  const addProduct = (pr: CatalogProduct, qty: number) => set({ lines: [...draft.lines, { key: key(), budgetItemId: null, productId: pr.id, sku: pr.sku, name: pr.name, description: null, quantity: qty, unit: "ea", unitCostCents: pr.costCents }] });
  const vendor = d.data.vendors.find((v) => v.id === draft.vendorId);

  return (
    <div className="space-y-4">
      <Link href={back} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"><ArrowLeft size={13} /> {p.job ? `${p.job.number} · ${p.job.name}` : "Purchasing"}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-accent">Purchase order</div>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{p.vendor?.name ?? "Vendor"} <span className="font-mono text-lg text-ink-muted">{p.number}</span></h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted"><PoPill s={p.status} />{p.job ? <Link href={`/avl/jobs/view?id=${p.job.id}`} className="hover:text-accent">{p.job.number} · {p.job.name}</Link> : <span>Stock (no job)</span>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.vendorUrl && <a className="btn-ghost" href={p.vendorUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Vendor copy</a>}
          {editable && dirty && <button className="btn-outline" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? <Spinner /> : <Check size={14} />} Save</button>}
          {p.status === "DRAFT" && !d.data.canApprove && <button className="btn-primary" disabled={!!busy} onClick={() => void event("SUBMIT", {}, "Sent for approval")}>{busy === "SUBMIT" ? <Spinner /> : <Send size={14} />} Send for approval</button>}
          {(p.status === "DRAFT" || p.status === "PENDING_APPROVAL") && d.data.canApprove && <>
            {p.status === "PENDING_APPROVAL" && <button className="btn-outline" disabled={!!busy} onClick={() => setModal("reject")}><Undo2 size={14} /> Send back</button>}
            <button className="btn-primary" disabled={!!busy} onClick={() => void event("APPROVE", {}, "Approved")}>{busy === "APPROVE" ? <Spinner /> : <CheckCircle2 size={14} />} Approve</button>
          </>}
          {p.status === "APPROVED" && <>
            <button className="btn-outline" disabled={!!busy} onClick={() => void event("MARK_ORDERED", {}, "Marked ordered")}>Mark ordered</button>
            <button className="btn-primary" disabled={!!busy} onClick={() => setModal("send")}><Send size={14} /> Email to vendor</button>
          </>}
          {poReceivable(p.status) && p.status !== "APPROVED" && <>
            <button className="btn-ghost" onClick={() => setModal("send")}><Send size={14} /> Email again</button>
            <button className="btn-primary" onClick={() => setModal("receive")}><PackageCheck size={14} /> Receive</button>
          </>}
          {["ORDERED", "PARTIAL", "RECEIVED"].includes(p.status) && <Link className="btn-outline" href={`/avl/purchasing/bill?new=1&po=${p.id}`}><Receipt size={14} /> Enter bill</Link>}
          {p.status === "CANCELLED" && <button className="btn-outline" onClick={() => void event("REOPEN", {}, "Reopened as a draft")}><RotateCcw size={14} /> Reopen</button>}
        </div>
      </div>

      {p.status === "PENDING_APPROVAL" && !d.data.canApprove && <p className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-2.5 text-sm text-warn">Waiting for an AVL Manager to approve it{p.submittedAt ? ` (sent ${fmtDateTime(p.submittedAt)})` : ""}.</p>}
      {p.rejectedNote && p.status === "DRAFT" && <p className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-2.5 text-sm text-bad"><b>Sent back:</b> {p.rejectedNote}</p>}

      <Facts items={[
        ["Total", <span key="t" className="font-mono font-semibold">{fmtMoney(editable ? t.totalCents : p.totalCents)}</span>],
        ["Needed by", day(p.expectedDate)],
        ["Made", `${fmtDateTime(p.createdAt)}${p.createdBy ? ` by ${p.createdBy}` : ""}`],
        ["Approved", p.approvedAt ? `${fmtDateTime(p.approvedAt)}${p.approvedBy ? ` by ${p.approvedBy}` : ""}` : null],
        ["Emailed", p.sentAt ? `${fmtDateTime(p.sentAt)} to ${p.sentTo}` : null],
        ["Billed", p.bills.length ? fmtMoney(p.billedCents) : null],
      ]} />

      {editable ? (
        <>
          <Card eyebrow="Order" title="Vendor and delivery">
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Vendor"><select className="input" value={draft.vendorId} onChange={(e) => set({ vendorId: e.target.value })}>{d.data.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
              <Field label="For job"><select className="input" value={draft.jobId ?? ""} onChange={(e) => set({ jobId: e.target.value || null, lines: draft.lines.map((l) => ({ ...l, budgetItemId: e.target.value === p.job?.id ? l.budgetItemId : null })) })}><option value="">Stock (no job)</option>{d.data.jobs.map((j) => <option key={j.id} value={j.id}>{j.number} · {j.name}</option>)}</select></Field>
              <Field label="Needed by"><input type="date" className="input" value={draft.expectedDate ?? ""} onChange={(e) => set({ expectedDate: e.target.value || null })} /></Field>
              <Field label="Ship to"><input className="input" value={draft.shipTo ?? ""} onChange={(e) => set({ shipTo: e.target.value || null })} placeholder="The shop, or the job site" /></Field>
              <Field label="Notes for the vendor" className="sm:col-span-2 lg:col-span-4"><textarea rows={2} className="input" value={draft.notes ?? ""} onChange={(e) => set({ notes: e.target.value || null })} placeholder="e.g. Call before delivery; dock closes at 3pm" /></Field>
            </div>
          </Card>
          <Card eyebrow="Lines" title={`${draft.lines.length} line${draft.lines.length === 1 ? "" : "s"}`} action={<div className="flex gap-2">
            <button className="btn-ghost text-xs" onClick={() => setModal("catalog")}><Search size={13} /> From price list</button>
            <button className="btn-ghost text-xs" onClick={() => set({ lines: [...draft.lines, { key: key(), budgetItemId: null, productId: null, sku: null, name: "", description: null, quantity: 1, unit: "ea", unitCostCents: 0 }] })}><Plus size={13} /> Custom line</button>
          </div>}>
            {draft.lines.length ? (
              <Table min={820} head={<tr><th>Item</th>{draft.jobId === p.job?.id && p.job && <th className="w-56">Job budget line</th>}<th className="w-24">Qty</th><th className="w-32 text-right">Unit cost</th><th className="w-28 text-right">Amount</th><th className="w-10" /></tr>}>
                {draft.lines.map((l) => (
                  <tr key={l.key}>
                    <td><input className="input py-1" value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder="What to order" /><input className="input mt-1 py-1 font-mono text-xs" value={l.sku ?? ""} onChange={(e) => setLine(l.key, { sku: e.target.value || null })} placeholder="SKU / part number" /></td>
                    {draft.jobId === p.job?.id && p.job && <td><BudgetItemSelect items={d.data!.budget} value={l.budgetItemId} onChange={(v) => setLine(l.key, { budgetItemId: v })} /></td>}
                    <td><input type="number" min={1} className="input min-w-[5.5rem] py-1 tabular-nums" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: Math.max(1, parseInt(e.target.value) || 1) })} /></td>
                    <td><MoneyInput cents={l.unitCostCents} onChange={(c) => setLine(l.key, { unitCostCents: c ?? 0 })} /></td>
                    <td className="text-right font-mono">{fmtMoney(Math.round(l.quantity * l.unitCostCents))}</td>
                    <td><button className="p-1 text-ink-faint hover:text-bad" title="Remove" onClick={() => set({ lines: draft.lines.filter((x) => x.key !== l.key) })}><X size={14} /></button></td>
                  </tr>
                ))}
              </Table>
            ) : <Empty>No lines yet. Add products from a price list, or a custom line.{p.job ? " Or order straight from the job’s budget (job → Purchasing → Order from the budget)." : ""}</Empty>}
            <Totals sub={t.subtotalCents} total={t.totalCents} shipping={draft.shippingCents} tax={draft.taxCents} onShipping={(c) => set({ shippingCents: c })} onTax={(c) => set({ taxCents: c })} />
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {p.status === "DRAFT" ? <button className="btn-ghost text-bad" onClick={async () => { if (!window.confirm(`Delete ${p.number}?`)) return; try { await ops(`/pos/${id}`, { method: "DELETE" }); void refresh(); router.push(back); } catch (e) { toast.error((e as Error).message); } }}><Trash2 size={14} /> Delete draft</button> : <span />}
            {dirty && <button className="btn-primary" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? <Spinner /> : <Check size={14} />} Save changes</button>}
          </div>
        </>
      ) : (
        <Card eyebrow="Lines" title="What's on order">
          <Table min={760} head={<tr><th>Item</th><th className="text-right">Ordered</th><th className="text-right">Received</th><th className="text-right">Billed</th><th className="text-right">Unit cost</th><th className="text-right">Amount</th></tr>}>
            {p.lines.map((l) => (
              <tr key={l.id}>
                <td><div className="font-medium">{l.name}</div><div className="font-mono text-[11px] text-ink-faint">{l.sku}</div></td>
                <td className="text-right tabular-nums">{l.quantity}</td>
                <td className={clsx("text-right tabular-nums", l.receivedQty >= l.quantity ? "text-ok" : l.receivedQty ? "text-warn" : "text-ink-faint")}>{l.receivedQty}</td>
                <td className="text-right tabular-nums text-ink-muted">{l.billedQty || "—"}</td>
                <td className="text-right font-mono">{fmtMoney(l.unitCostCents)}</td>
                <td className="text-right font-mono">{fmtMoney(Math.round(l.quantity * l.unitCostCents))}</td>
              </tr>
            ))}
          </Table>
          <Totals sub={p.subtotalCents} total={p.totalCents} shipping={p.shippingCents} tax={p.taxCents} />
          {p.notes && <p className="border-t border-line px-4 py-3 text-sm text-ink-soft"><span className="text-ink-muted">Notes: </span>{p.notes}</p>}
          {!["CANCELLED", "RECEIVED"].includes(p.status) && !p.lines.some((l) => l.receivedQty > 0) && (
            <div className="border-t border-line px-4 py-2.5 text-right"><button className="text-xs text-bad hover:underline" onClick={() => { if (window.confirm(`Cancel ${p.number}? Its cost comes off the job.`)) void event("CANCEL", {}, "Cancelled"); }}>Cancel this order</button></div>
          )}
        </Card>
      )}

      {(p.receipts.length > 0 || p.bills.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card eyebrow="Receiving" title="What arrived">
            {p.receipts.length ? <div className="divide-y divide-line">{p.receipts.map((r) => (
              <div key={r.id} className="px-4 py-2.5 text-sm">
                <div className="flex justify-between gap-2"><span className="font-medium">{r.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}</span><span className="shrink-0 text-xs text-ink-muted">{fmtDateTime(r.at)}</span></div>
                <div className="text-xs text-ink-muted">{r.by ?? ""}{r.note ? ` · ${r.note}` : ""}</div>
              </div>
            ))}</div> : <Empty>Nothing received yet.</Empty>}
          </Card>
          <Card eyebrow="Bills" title="What the vendor charged">
            {p.bills.length ? <div className="divide-y divide-line">{p.bills.map((b) => (
              <Link key={b.id} href={`/avl/purchasing/bill?id=${b.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-hover/40">
                <span><span className="font-medium">{b.billNumber ? `Bill ${b.billNumber}` : "Bill"}</span> <span className="text-xs text-ink-muted">{day(b.billDate)}</span></span>
                <span className="flex items-center gap-2"><BillPill s={b.status} /><span className="font-mono">{fmtMoney(b.totalCents)}</span></span>
              </Link>
            ))}</div> : <Empty>No bills yet.</Empty>}
          </Card>
        </div>
      )}

      {modal === "catalog" && <CatalogPicker vendors={d.data.vendors} onAdd={addProduct} onClose={() => setModal(null)} title={`Add from price lists${vendor ? ` (ordering from ${vendor.name})` : ""}`} />}
      {modal === "send" && <SendModal title={`Email ${p.number} to ${p.vendor?.name ?? "the vendor"}`} defaultTo={p.sentTo ?? p.vendor?.repEmail ?? null} button={p.sentAt ? "Send again" : "Send and mark ordered"}
        intro={<>The vendor gets the order in the email, with a link to a printable copy. Replies come to your business email.</>}
        onSend={async (to) => { await event("SEND", { emailTo: to }); toast.success(`Sent to ${to}`); }} onClose={() => setModal(null)} />}
      {modal === "reject" && <NoteModal title={`Send ${p.number} back`} label="What needs to change?" placeholder="e.g. Use the 4-pack price; split the cable onto ADI" button="Send back" onSave={async (note) => { await event("REJECT", { note }); toast.success("Sent back"); }} onClose={() => setModal(null)} />}
      {modal === "receive" && <ReceiveModal po={p} onClose={() => setModal(null)} onDone={() => { setModal(null); void d.refetch(); void refresh(); }} />}
    </div>
  );
}

function Totals({ sub, total, shipping, tax, onShipping, onTax }: { sub: number; total: number; shipping: number; tax: number; onShipping?: (c: number) => void; onTax?: (c: number) => void }) {
  const row = (label: string, v: React.ReactNode, strong?: boolean) => <div className={clsx("flex items-center justify-between gap-4", strong && "border-t border-line pt-2 text-[15px] font-semibold")}><span className="text-ink-muted">{label}</span><span className="font-mono">{v}</span></div>;
  return (
    <div className="ml-auto max-w-xs space-y-1.5 border-t border-line px-4 py-3 text-sm">
      {row("Subtotal", fmtMoney(sub))}
      {row("Shipping", onShipping ? <MoneyInput className="w-28 py-1 text-right" cents={shipping} onChange={(c) => onShipping(c ?? 0)} /> : fmtMoney(shipping))}
      {row("Tax", onTax ? <MoneyInput className="w-28 py-1 text-right" cents={tax} onChange={(c) => onTax(c ?? 0)} /> : fmtMoney(tax))}
      {row("Total", fmtMoney(total), true)}
    </div>
  );
}

function ReceiveModal({ po, onClose, onDone }: { po: PurchaseOrder; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState<Record<string, number>>(Object.fromEntries(po.lines.map((l) => [l.id, l.quantity - l.receivedQty])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={`Receive ${po.number}`} width={640}>
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { await ops(`/pos/${po.id}/receive`, { json: { lines: Object.entries(qty).filter(([, q]) => q).map(([itemId, q]) => ({ itemId, qty: q })), note: note || null } }); toast.success("Received"); onDone(); }
        catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <div className="max-h-[50vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_th]:px-4 [&_th]:py-2"><tr><th>Item</th><th className="text-right">Ordered</th><th className="text-right">In</th><th className="w-28">Arrived now</th></tr></thead>
            <tbody className="divide-y divide-line [&_td]:px-4 [&_td]:py-2">
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td><div className="font-medium">{l.name}</div><div className="font-mono text-[11px] text-ink-faint">{l.sku}</div></td>
                  <td className="text-right tabular-nums">{l.quantity}</td><td className="text-right tabular-nums text-ink-muted">{l.receivedQty}</td>
                  <td><input type="number" className="input py-1 tabular-nums" min={-l.receivedQty} max={l.quantity - l.receivedQty} value={qty[l.id] ?? 0} onChange={(e) => setQty({ ...qty, [l.id]: parseInt(e.target.value) || 0 })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-3 border-t border-line p-4">
          <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 1 backordered until 11/12; box 2 damaged" /></Field>
          <p className="text-[11px] text-ink-faint">A negative number corrects an earlier count.</p>
          {error && <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? <Spinner /> : <PackageCheck size={14} />} Record what arrived</button></div>
        </div>
      </form>
    </Modal>
  );
}
