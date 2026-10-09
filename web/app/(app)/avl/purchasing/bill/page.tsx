"use client";
/**
 * A vendor bill: what a vendor actually charged, line by line against the job's budget. Made from a
 * purchase order or work order (its lines come filled in) or by hand. ?new=1[&po=…|&wo=…|&job=…]
 */
import { ArrowLeft, Ban, Check, CheckCircle2, Paperclip, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { BudgetItem, JobPage } from "@shared/ops/jobs";
import { billTotal, type PurchaseOrder, type PurchasingPage, type VendorBill, type WorkOrder } from "@shared/ops/purchasing";
import { fmtDateTime, fmtMoney, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Field, Loading, MoneyInput, Table } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";
import { BillPill, BudgetItemSelect } from "@/components/avl/purchasing/bits";
import { uploadToJob } from "@/components/avl/project/bits";

interface BillPage { bill: VendorBill; vendors: { id: string; name: string }[]; budget: BudgetItem[]; po: PurchaseOrder | null; wo: WorkOrder | null }
type Line = { key: string; budgetItemId: string | null; poItemId: string | null; workOrderItemId: string | null; description: string; quantity: number; unitCostCents: number };
interface Draft { vendorId: string | null; jobId: string | null; poId: string | null; workOrderId: string | null; billNumber: string; billDate: string; dueDate: string; otherCents: number; notes: string; fileId: string | null; fileName: string | null; lines: Line[] }

export default function Page() { return <Suspense><BillView /></Suspense>; }

const k = () => Math.random().toString(36).slice(2, 10);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const plus30 = (d: string) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + 30); return x.toISOString().slice(0, 10); };

function BillView() {
  const sp = useSearchParams();
  const id = sp.get("id");
  const isNew = !id;
  const poId = sp.get("po"), woId = sp.get("wo"), jobParam = sp.get("job");
  const existing = useOps<BillPage>(id ? `/bills/${id}` : null);
  const list = useOps<PurchasingPage>(isNew ? "/purchasing" : null);
  const po = useOps<{ po: PurchaseOrder; budget: BudgetItem[] }>(isNew && poId ? `/pos/${poId}` : null);
  const wo = useOps<{ wo: WorkOrder; budget: BudgetItem[] }>(isNew && woId ? `/work-orders/${woId}` : null);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (draft) return;
    if (existing.data) {
      const b = existing.data.bill;
      setDraft({ vendorId: b.vendor?.id ?? null, jobId: b.job?.id ?? null, poId: b.po?.id ?? null, workOrderId: b.workOrder?.id ?? null, billNumber: b.billNumber ?? "", billDate: b.billDate, dueDate: b.dueDate ?? "", otherCents: b.otherCents, notes: b.notes ?? "", fileId: b.file?.id ?? null, fileName: b.file?.name ?? null,
        lines: b.lines.map((l) => ({ key: l.id, budgetItemId: l.budgetItemId, poItemId: l.poItemId, workOrderItemId: l.workOrderItemId, description: l.description, quantity: l.quantity, unitCostCents: l.unitCostCents })) });
    } else if (isNew && list.data && (!poId || po.data) && (!woId || wo.data)) {
      const d0 = today();
      const base: Draft = { vendorId: null, jobId: jobParam, poId: null, workOrderId: null, billNumber: "", billDate: d0, dueDate: plus30(d0), otherCents: 0, notes: "", fileId: null, fileName: null, lines: [] };
      if (po.data) {
        const p = po.data.po;
        Object.assign(base, { vendorId: p.vendor?.id ?? null, jobId: p.job?.id ?? null, poId: p.id, otherCents: p.bills.length ? 0 : p.shippingCents + p.taxCents,
          lines: p.lines.filter((l) => l.quantity - l.billedQty > 0).map((l) => ({ key: k(), budgetItemId: l.budgetItemId, poItemId: l.id, workOrderItemId: null, description: l.name, quantity: l.quantity - l.billedQty, unitCostCents: l.unitCostCents })) });
      } else if (wo.data) {
        const w = wo.data.wo;
        Object.assign(base, { vendorId: w.vendor?.id ?? null, jobId: w.job.id, workOrderId: w.id,
          lines: w.lines.map((l) => ({ key: k(), budgetItemId: l.budgetItemId, poItemId: null, workOrderItemId: l.id, description: l.description, quantity: l.quantity, unitCostCents: l.unitCostCents })) });
      } else base.lines = [{ key: k(), budgetItemId: null, poItemId: null, workOrderItemId: null, description: "", quantity: 1, unitCostCents: 0 }];
      setDraft(base);
    }
  }, [draft, existing.data, list.data, po.data, wo.data, isNew, poId, woId, jobParam]);

  const err = existing.error ?? list.error ?? po.error ?? wo.error;
  if (!draft) return <><ErrorBox error={err} />{!err && <Loading />}</>;
  return <BillForm id={id} draft={draft} setDraft={setDraft} page={existing.data ?? null} vendors={existing.data?.vendors ?? list.data?.vendors ?? []} jobs={list.data?.jobs ?? null}
    poNumber={existing.data?.bill.po?.number ?? po.data?.po.number ?? null} woNumber={existing.data?.bill.workOrder?.number ?? wo.data?.wo.number ?? null}
    onSaved={() => { void existing.refetch(); }} />;
}

function BillForm({ id, draft, setDraft, page, vendors, jobs, poNumber, woNumber, onSaved }: { id: string | null; draft: Draft; setDraft: (d: Draft) => void; page: BillPage | null; vendors: { id: string; name: string }[]; jobs: { id: string; number: string; name: string }[] | null; poNumber: string | null; woNumber: string | null; onSaved: () => void }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const job = useOps<JobPage>(draft.jobId ? `/jobs/${draft.jobId}` : null);
  const budget = job.data?.budget ?? page?.budget ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(!id);
  const file = useRef<HTMLInputElement>(null);
  const bill = page?.bill;
  const locked = bill?.status === "VOID";
  const set = (x: Partial<Draft>) => { setDraft({ ...draft, ...x }); setDirty(true); };
  const setLine = (key: string, x: Partial<Line>) => set({ lines: draft.lines.map((l) => (l.key === key ? { ...l, ...x } : l)) });
  const total = billTotal(draft.lines, draft.otherCents);
  const back = draft.jobId ? `/avl/jobs/view?id=${draft.jobId}&tab=purchasing` : "/avl/purchasing?tab=bills";

  async function save() {
    setBusy("save");
    try {
      const json = { vendorId: draft.vendorId, jobId: draft.jobId, poId: draft.poId, workOrderId: draft.workOrderId, billNumber: draft.billNumber || null, billDate: draft.billDate, dueDate: draft.dueDate || null, otherCents: draft.otherCents, notes: draft.notes || null, fileId: draft.fileId,
        lines: draft.lines.filter((l) => l.description.trim()).map(({ key: _k, ...l }) => l) };
      if (id) { await ops(`/bills/${id}`, { method: "PUT", json }); setDirty(false); onSaved(); toast.success("Saved"); }
      else { const b = await ops<VendorBill>("/bills", { json }); void refresh(); toast.success("Bill entered"); router.replace(`/avl/purchasing/bill?id=${b.id}`); }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  async function status(s: "OPEN" | "PAID" | "VOID") {
    setBusy(s);
    try { await ops(`/bills/${id}/status`, { json: { status: s } }); onSaved(); void refresh(); toast.success(s === "PAID" ? "Marked paid" : s === "VOID" ? "Voided" : "Reopened"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  async function attach(f: File) {
    if (!draft.jobId) return toast.error("Pick the job first: the bill's scan is kept with the job's files.");
    setBusy("file");
    try { const jf = await uploadToJob(draft.jobId, f, { folder: "Bills" }); set({ fileId: jf.id, fileName: jf.name }); toast.success("Attached. Save to keep it with the bill."); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <Link href={back} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"><ArrowLeft size={13} /> Back</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-accent">Vendor bill</div>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{id ? `${bill?.vendor?.name ?? "Bill"}${bill?.billNumber ? ` #${bill.billNumber}` : ""}` : "Enter a bill"}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {bill && <BillPill s={bill.status} />}
            {poNumber && <Link className="hover:text-accent" href={`/avl/purchasing/po?id=${draft.poId}`}>for {poNumber}</Link>}
            {woNumber && <Link className="hover:text-accent" href={`/avl/purchasing/wo?id=${draft.workOrderId}`}>for {woNumber}</Link>}
            {bill?.paidAt && <span>paid {fmtDateTime(bill.paidAt)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {bill?.status === "OPEN" && <button className="btn-outline" disabled={!!busy} onClick={() => void status("PAID")}><CheckCircle2 size={14} /> Mark paid</button>}
          {bill && bill.status !== "OPEN" && <button className="btn-ghost" disabled={!!busy} onClick={() => void status("OPEN")}><RotateCcw size={14} /> Reopen</button>}
          {!locked && (dirty || !id) && <button className="btn-primary" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? <Spinner /> : <Check size={14} />} {id ? "Save" : "Enter bill"}</button>}
        </div>
      </div>

      <Card eyebrow="Bill" title="Who and when">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Vendor"><select className="input" disabled={locked} value={draft.vendorId ?? ""} onChange={(e) => set({ vendorId: e.target.value || null })}><option value="">Pick a vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          <Field label="Job">{jobs && !draft.poId && !draft.workOrderId
            ? <select className="input" disabled={locked} value={draft.jobId ?? ""} onChange={(e) => set({ jobId: e.target.value || null, lines: draft.lines.map((l) => ({ ...l, budgetItemId: null })) })}><option value="">Overhead (no job)</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.number} · {j.name}</option>)}</select>
            : <div className="input bg-hover/40">{bill?.job ? `${bill.job.number} · ${bill.job.name}` : job.data ? `${job.data.job.number} · ${job.data.job.name}` : "—"}</div>}</Field>
          <Field label="Vendor's bill number"><input className="input font-mono" disabled={locked} value={draft.billNumber} onChange={(e) => set({ billNumber: e.target.value })} placeholder="INV-1234" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Bill date"><input type="date" required className="input" disabled={locked} value={draft.billDate} onChange={(e) => set({ billDate: e.target.value })} /></Field>
            <Field label="Due"><input type="date" className="input" disabled={locked} value={draft.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
          </div>
        </div>
      </Card>

      <Card eyebrow="Lines" title="What it's for" action={!locked && <button className="btn-ghost text-xs" onClick={() => set({ lines: [...draft.lines, { key: k(), budgetItemId: null, poItemId: null, workOrderItemId: null, description: "", quantity: 1, unitCostCents: 0 }] })}><Plus size={13} /> Line</button>}>
        <Table min={760} head={<tr><th>Description</th>{draft.jobId && <th className="w-60">Job budget line</th>}<th className="w-24">Qty</th><th className="w-32 text-right">Unit cost</th><th className="w-28 text-right">Amount</th><th className="w-10" /></tr>}>
          {!draft.lines.length && <tr><td colSpan={draft.jobId ? 6 : 5} className="py-6 text-center text-sm text-ink-faint">{draft.poId ? "Everything on this PO has been billed. Add a line for anything extra." : draft.workOrderId ? "Nothing left to bill on this work order. Add a line for anything extra." : "No lines yet."}</td></tr>}
          {draft.lines.map((l) => (
            <tr key={l.key}>
              <td><input className="input py-1" disabled={locked} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="What was charged" />{l.poItemId && <div className="mt-0.5 text-[11px] text-ink-faint">from the PO</div>}</td>
              {draft.jobId && <td><BudgetItemSelect items={budget} value={l.budgetItemId} disabled={locked} onChange={(v) => setLine(l.key, { budgetItemId: v })} /></td>}
              <td><input type="number" step="any" className="input min-w-[5.5rem] py-1 tabular-nums" disabled={locked} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: Number(e.target.value) || 0 })} /></td>
              <td><MoneyInput cents={l.unitCostCents} disabled={locked} onChange={(c) => setLine(l.key, { unitCostCents: c ?? 0 })} /></td>
              <td className="text-right font-mono">{fmtMoney(Math.round(l.quantity * l.unitCostCents))}</td>
              <td>{!locked && <button className="p-1 text-ink-faint hover:text-bad" title="Remove" onClick={() => set({ lines: draft.lines.filter((x) => x.key !== l.key) })}><X size={14} /></button>}</td>
            </tr>
          ))}
        </Table>
        <div className="ml-auto max-w-xs space-y-1.5 border-t border-line px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-4"><span className="text-ink-muted">Shipping, freight, tax</span><MoneyInput className="w-28" cents={draft.otherCents} disabled={locked} onChange={(c) => set({ otherCents: c ?? 0 })} /></div>
          <div className="flex items-center justify-between gap-4 border-t border-line pt-2 text-[15px] font-semibold"><span>Total</span><span className="font-mono">{fmtMoney(total)}</span></div>
        </div>
        <p className="border-t border-line px-4 py-2 text-[11px] text-ink-faint">For a credit, use a negative quantity. Lines on a budget line count as that line's actual cost in job costing; the rest counts on the job as a whole.</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card eyebrow="Notes" title="Notes"><div className="p-4"><textarea rows={3} className="input" disabled={locked} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. Paid by check 1042" /></div></Card>
        <Card eyebrow="Scan" title="The bill itself">
          <div className="flex flex-wrap items-center gap-3 p-4 text-sm">
            {draft.fileId ? <>
              <Paperclip size={15} className="text-accent" />
              {bill?.file?.url && bill.file.id === draft.fileId ? <a className="font-medium hover:text-accent" href={bill.file.url} target="_blank" rel="noreferrer">{draft.fileName}</a> : <span className="font-medium">{draft.fileName}</span>}
              {!locked && <button className="text-xs text-ink-muted hover:text-bad" onClick={() => set({ fileId: null, fileName: null })}>Remove</button>}
            </> : <span className="text-ink-faint">No scan attached.</span>}
            {!locked && <button className="btn-outline ml-auto py-1.5 text-xs" disabled={busy === "file"} onClick={() => file.current?.click()}>{busy === "file" ? <Spinner /> : <Upload size={13} />} Attach PDF or photo</button>}
            <input ref={file} type="file" hidden accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = ""; }} />
          </div>
        </Card>
      </div>

      {bill && (
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {bill.status !== "VOID" && <button className="btn-ghost text-bad" onClick={() => { if (window.confirm("Void this bill? It stops counting as cost.")) void status("VOID"); }}><Ban size={14} /> Void</button>}
            <button className="btn-ghost text-bad" onClick={async () => { if (!window.confirm("Delete this bill for good?")) return; try { await ops(`/bills/${bill.id}`, { method: "DELETE" }); void refresh(); router.push(back); } catch (e) { toast.error((e as Error).message); } }}><Trash2 size={14} /> Delete</button>
          </div>
          <span className="text-xs text-ink-faint">Entered {fmtDateTime(bill.createdAt)}{bill.createdBy ? ` by ${bill.createdBy}` : ""}</span>
        </div>
      )}
    </div>
  );
}
