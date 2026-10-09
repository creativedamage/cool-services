"use client";
/**
 * A change order: lines added to the job (or credited back) after the sale. Sent to the client to
 * sign online like a proposal, or approved by an AVL Manager who records how the client agreed.
 * Once approved, each line joins the job's budget under its cost group.
 */
import clsx from "clsx";
import { ArrowLeft, Check, CheckCircle2, Copy, ExternalLink, FileSignature, Plus, RotateCcw, Search, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { COST_TYPES } from "@shared/ops/jobs";
import { priceForMargin } from "@shared/ops/math";
import { coTotals, type ChangeOrder, type CoLine } from "@shared/ops/purchasing";
import type { CatalogProduct } from "@shared/ops/types";
import { fmtDateTime, fmtMoney, fmtPct, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Field, Loading, MoneyInput, PercentInput, Table } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";
import { CatalogPicker } from "@/components/avl/CatalogPicker";
import { CoPill, Facts, NoteModal, SendModal } from "@/components/avl/purchasing/bits";

interface CoPage { co: ChangeOrder; clientEmail: string | null; groups: string[]; canApprove: boolean; vendors: { id: string; name: string }[]; defaultMarginBps: number }
type Draft = { title: string; description: string; taxBps: number; lines: (Omit<CoLine, "id" | "budgetItemId" | "sortOrder"> & { key: string })[] };

export default function Page() { return <Suspense><CoView /></Suspense>; }
const k = () => Math.random().toString(36).slice(2, 10);

function CoView() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const refresh = useOpsRefresh();
  const d = useOps<CoPage>(id ? `/change-orders/${id}` : null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"send" | "approve" | "catalog" | null>(null);
  const co = d.data?.co;
  useEffect(() => {
    if (co && !dirty) setDraft({ title: co.title, description: co.description ?? "", taxBps: co.taxBps, lines: co.lines.map(({ id: lid, budgetItemId: _b, sortOrder: _s, ...l }) => ({ ...l, key: lid })) });
  }, [co, dirty]);
  if (!d.data || !draft) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const c = d.data.co;
  const editable = c.status === "DRAFT";
  const t = editable ? coTotals(draft.lines, draft.taxBps) : c.totals;
  const set = (x: Partial<Draft>) => { setDraft({ ...draft, ...x }); setDirty(true); };
  const setLine = (key: string, x: Partial<Draft["lines"][number]>) => set({ lines: draft.lines.map((l) => (l.key === key ? { ...l, ...x } : l)) });
  const blank = (group = draft.lines.at(-1)?.groupName ?? d.data.groups[0] ?? "Changes") => ({ key: k(), groupName: group, name: "", description: null, costType: "MATERIAL" as const, quantity: 1, unit: null, unitCostCents: 0, unitPriceCents: 0, taxable: true, productId: null });
  const back = `/avl/jobs/view?id=${c.job.id}&tab=changes`;

  async function save(quiet = false) {
    setBusy("save");
    try { await ops(`/change-orders/${id}`, { method: "PUT", json: { title: draft!.title, description: draft!.description || null, taxBps: draft!.taxBps, lines: draft!.lines.map(({ key: _k, ...l }) => l) } }); setDirty(false); await d.refetch(); if (!quiet) toast.success("Saved"); return true; }
    catch (e) { toast.error((e as Error).message); return false; } finally { setBusy(null); }
  }
  async function event(event: string, extra: Record<string, unknown> = {}, done?: string) {
    if (dirty && !(await save(true))) return;
    setBusy(event);
    try { await ops(`/change-orders/${id}/events`, { json: { event, ...extra } }); await d.refetch(); void refresh(); if (done) toast.success(done); setModal(null); }
    catch (e) { if (event === "SEND" || event === "MARK_APPROVED") throw e; toast.error((e as Error).message); } finally { setBusy(null); }
  }
  const addProduct = (p: CatalogProduct, qty: number) => set({ lines: [...draft.lines, { ...blank(), name: p.name, productId: p.id, quantity: qty, unitCostCents: p.costCents, unitPriceCents: priceForMargin(p.costCents, d.data!.defaultMarginBps) }] });

  return (
    <div className="space-y-4">
      <Link href={back} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"><ArrowLeft size={13} /> {c.job.number} · {c.job.name}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-accent">Change order <span className="font-mono">{c.number}</span></div>
          {editable ? <input className="mt-0.5 w-full min-w-[18rem] bg-transparent text-2xl font-semibold tracking-tight outline-none focus:underline" value={draft.title} onChange={(e) => set({ title: e.target.value })} /> : <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{c.title}</h1>}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted"><CoPill s={c.status} />{c.approvedAt && <span>approved {fmtDateTime(c.approvedAt)}</span>}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.clientUrl && c.status !== "CANCELLED" && <>
            <button className="btn-ghost" onClick={() => { void navigator.clipboard.writeText(c.clientUrl!); toast.success("Link copied"); }}><Copy size={14} /> Copy link</button>
            <a className="btn-ghost" href={c.clientUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Client's view</a>
          </>}
          {editable && dirty && <button className="btn-outline" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? <Spinner /> : <Check size={14} />} Save</button>}
          {editable && <button className="btn-outline" disabled={!!busy} onClick={() => void event("MARK_SENT", {}, "Ready to sign. Copy the link to share it.")}>Get the link</button>}
          {(editable || c.status === "SENT") && <button className="btn-primary" onClick={() => setModal("send")}><Send size={14} /> {c.status === "SENT" ? "Email again" : "Email to client"}</button>}
          {(editable || c.status === "SENT") && d.data.canApprove && <button className="btn-outline" onClick={() => setModal("approve")}><CheckCircle2 size={14} /> Record approval</button>}
          {(c.status === "SENT" || c.status === "DECLINED") && <button className="btn-ghost" onClick={() => void event("REVISE", {}, "Back to draft")}><RotateCcw size={14} /> Revise</button>}
        </div>
      </div>

      {c.status === "DECLINED" && <p className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-2.5 text-sm text-bad">Declined {c.declinedAt ? fmtDateTime(c.declinedAt) : ""}{c.declineNote ? `: “${c.declineNote}”` : ""}. Revise it to change and resend.</p>}
      {c.status === "APPROVED" && (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok">
          <FileSignature size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            {c.signature ? <>Signed by <b>{c.signature.signerName}</b>{c.signature.signerTitle ? `, ${c.signature.signerTitle}` : ""} on {fmtDateTime(c.signature.signedAt)} for {fmtMoney(c.signature.totalCents)}.</> : <>Approved: {c.approvedNote}</>}
            <div className="text-xs opacity-80">Its lines are in the job's budget, each named “{c.number}: …”.</div>
          </div>
          {c.signature?.image && <img src={c.signature.image} alt="Signature" className="h-12 rounded bg-white px-2" />}
        </div>
      )}

      <Facts items={[[t.totalCents < 0 ? "Credit" : "Amount", <span key="t" className="font-mono font-semibold">{fmtMoney(t.totalCents)}</span>], ["Cost", fmtMoney(t.costCents)], ["Profit", fmtMoney(t.profitCents)], ["Sent", c.sentAt ? fmtDateTime(c.sentAt) : null]]} />

      <Card eyebrow="For the client" title="What's changing">
        <div className="p-4"><textarea rows={3} className="input" disabled={!editable} value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Per our walkthrough on Nov 4: add a confidence monitor at the stage lip; the second cable run isn't needed." /></div>
      </Card>

      <Card eyebrow="Lines" title={`${draft.lines.length} line${draft.lines.length === 1 ? "" : "s"}`} action={editable && <div className="flex gap-2">
        <button className="btn-ghost text-xs" onClick={() => setModal("catalog")}><Search size={13} /> From price list</button>
        <button className="btn-ghost text-xs" onClick={() => set({ lines: [...draft.lines, blank()] })}><Plus size={13} /> Line</button>
      </div>}>
        <datalist id="co-groups">{d.data.groups.map((g) => <option key={g} value={g} />)}</datalist>
        <Table min={980} head={<tr><th className="w-40">Cost group</th><th>Item</th><th className="w-32">Kind</th><th className="w-24">Qty</th><th className="w-28 text-right">Unit cost</th><th className="w-28 text-right">Unit price</th><th className="w-12">Tax</th><th className="w-28 text-right">Price</th><th className="w-10" /></tr>}>
          {draft.lines.map((l) => (
            <tr key={l.key}>
              <td><input list="co-groups" className="input py-1 text-xs" disabled={!editable} value={l.groupName} onChange={(e) => setLine(l.key, { groupName: e.target.value })} /></td>
              <td><input className="input py-1" disabled={!editable} value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder="e.g. 55&quot; confidence monitor" /></td>
              <td><select className="input py-1 text-xs" disabled={!editable} value={l.costType} onChange={(e) => setLine(l.key, { costType: e.target.value as typeof l.costType })}>{COST_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></td>
              <td><input type="number" step="any" className="input min-w-[5.5rem] py-1 tabular-nums" disabled={!editable} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: Number(e.target.value) || 0 })} /></td>
              <td><MoneyInput cents={l.unitCostCents} disabled={!editable} onChange={(v) => setLine(l.key, { unitCostCents: v ?? 0 })} /></td>
              <td><MoneyInput cents={l.unitPriceCents} disabled={!editable} onChange={(v) => setLine(l.key, { unitPriceCents: v ?? 0 })} /></td>
              <td className="text-center"><input type="checkbox" disabled={!editable} checked={l.taxable} onChange={(e) => setLine(l.key, { taxable: e.target.checked })} /></td>
              <td className={clsx("text-right font-mono", l.quantity < 0 && "text-bad")}>{fmtMoney(Math.round(l.quantity * l.unitPriceCents))}</td>
              <td>{editable && <button className="p-1 text-ink-faint hover:text-bad" onClick={() => set({ lines: draft.lines.filter((x) => x.key !== l.key) })}><X size={14} /></button>}</td>
            </tr>
          ))}
          {!draft.lines.length && <tr><td colSpan={9} className="py-8 text-center text-sm text-ink-faint">No lines yet. Add what's being added (or a negative quantity for something taken out).</td></tr>}
        </Table>
        <div className="ml-auto max-w-xs space-y-1.5 border-t border-line px-4 py-3 text-sm">
          <div className="flex justify-between"><span className="text-ink-muted">Subtotal</span><span className="font-mono">{fmtMoney(t.subtotalCents)}</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-ink-muted">Tax {editable ? "" : `(${fmtPct(c.taxBps)})`}</span>{editable ? <div className="flex items-center gap-2"><div className="w-24"><PercentInput bps={draft.taxBps} onChange={(b) => set({ taxBps: b })} /></div><span className="font-mono">{fmtMoney(t.taxCents)}</span></div> : <span className="font-mono">{fmtMoney(t.taxCents)}</span>}</div>
          <div className="flex justify-between border-t border-line pt-2 text-[15px] font-semibold"><span>Total</span><span className="font-mono">{fmtMoney(t.totalCents)}</span></div>
        </div>
        <p className="border-t border-line px-4 py-2 text-[11px] text-ink-faint">A negative quantity is a credit. The client sees prices only, never your costs.</p>
      </Card>

      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          {["DRAFT", "SENT", "DECLINED"].includes(c.status) && <button className="btn-ghost text-bad" onClick={() => { if (window.confirm(`Cancel ${c.number}?`)) void event("CANCEL", {}, "Cancelled"); }}>Cancel change order</button>}
          {(c.status === "DRAFT" || c.status === "CANCELLED") && <button className="btn-ghost text-bad" onClick={async () => { if (!window.confirm(`Delete ${c.number}?`)) return; try { await ops(`/change-orders/${id}`, { method: "DELETE" }); void refresh(); router.push(back); } catch (e) { toast.error((e as Error).message); } }}><Trash2 size={14} /> Delete</button>}
        </div>
        {editable && dirty && <button className="btn-primary" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? <Spinner /> : <Check size={14} />} Save changes</button>}
      </div>

      {modal === "catalog" && <CatalogPicker vendors={d.data.vendors} onAdd={addProduct} onClose={() => setModal(null)} priceOf={(p) => priceForMargin(p.costCents, d.data!.defaultMarginBps)} />}
      {modal === "send" && <SendModal title={`Email ${c.number} to the client`} defaultTo={d.data.clientEmail} button="Send to sign"
        intro={<>The client gets a link to read the change order and sign it on their phone or computer. Once they sign, its lines join the job's budget.</>}
        onSend={async (to) => { await event("SEND", { emailTo: to }); toast.success(`Sent to ${to}`); }} onClose={() => setModal(null)} />}
      {modal === "approve" && <NoteModal title={`Record the client's approval of ${c.number}`} label="How did the client approve it?" placeholder="e.g. Pat approved by email on Nov 4" button="Approve and add to the budget"
        onSave={async (note) => { await event("MARK_APPROVED", { note }); toast.success("Approved: lines added to the budget"); }} onClose={() => setModal(null)} />}
    </div>
  );
}
