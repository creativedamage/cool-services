"use client";
/**
 * A work order: scope and cost for a subcontractor or installer on a job. Sent by email (with a
 * link they open to accept it) or marked sent; its cost is committed to the job's budget lines.
 */
import { ArrowLeft, Check, CheckCircle2, Copy, ExternalLink, Plus, Receipt, RotateCcw, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import type { BudgetItem } from "@shared/ops/jobs";
import type { WoLine, WorkOrder } from "@shared/ops/purchasing";
import { fmtDateTime, fmtMoney, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Field, Loading, MoneyInput, Table } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";
import { BillPill, BudgetItemSelect, day, Facts, SendModal, WoPill } from "@/components/avl/purchasing/bits";

interface WoPage { wo: WorkOrder; vendors: { id: string; name: string; repEmail: string | null }[]; budget: BudgetItem[] }
type Draft = Pick<WorkOrder, "title" | "assigneeName" | "assigneeEmail" | "scope" | "startDate" | "dueDate"> & { vendorId: string | null; lines: (Omit<WoLine, "id" | "sortOrder"> & { key: string })[] };

export default function Page() { return <Suspense><WoView /></Suspense>; }
const k = () => Math.random().toString(36).slice(2, 10);

function WoView() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const refresh = useOpsRefresh();
  const d = useOps<WoPage>(id ? `/work-orders/${id}` : null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [send, setSend] = useState(false);
  const wo = d.data?.wo;
  useEffect(() => {
    if (wo && !dirty) setDraft({ title: wo.title, vendorId: wo.vendor?.id ?? null, assigneeName: wo.assigneeName, assigneeEmail: wo.assigneeEmail, scope: wo.scope, startDate: wo.startDate, dueDate: wo.dueDate,
      lines: wo.lines.map((l) => ({ key: l.id, budgetItemId: l.budgetItemId, description: l.description, quantity: l.quantity, unit: l.unit, unitCostCents: l.unitCostCents })) });
  }, [wo, dirty]);
  if (!d.data || !draft) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const w = d.data.wo;
  const open = w.status !== "DONE" && w.status !== "CANCELLED";
  const set = (x: Partial<Draft>) => { setDraft({ ...draft, ...x }); setDirty(true); };
  const setLine = (key: string, x: Partial<Draft["lines"][number]>) => set({ lines: draft.lines.map((l) => (l.key === key ? { ...l, ...x } : l)) });
  const total = draft.lines.reduce((s, l) => s + Math.round(l.quantity * l.unitCostCents), 0);
  const back = `/avl/jobs/view?id=${w.job.id}&tab=purchasing`;

  async function save(quiet = false) {
    setBusy("save");
    try { await ops(`/work-orders/${id}`, { method: "PUT", json: { ...draft, lines: draft!.lines.map(({ key: _k, ...l }) => l) } }); setDirty(false); await d.refetch(); if (!quiet) toast.success("Saved"); return true; }
    catch (e) { toast.error((e as Error).message); return false; } finally { setBusy(null); }
  }
  async function event(event: string, extra: Record<string, unknown> = {}, done?: string) {
    if (dirty && !(await save(true))) return;
    setBusy(event);
    try { await ops(`/work-orders/${id}/events`, { json: { event, ...extra } }); await d.refetch(); void refresh(); if (done) toast.success(done); }
    catch (e) { if (event === "SEND") throw e; toast.error((e as Error).message); } finally { setBusy(null); }
  }
  const vendorEmail = d.data.vendors.find((v) => v.id === draft.vendorId)?.repEmail ?? null;

  return (
    <div className="space-y-4">
      <Link href={back} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"><ArrowLeft size={13} /> {w.job.number} · {w.job.name}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-accent">Work order <span className="font-mono">{w.number}</span></div>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{w.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted"><WoPill s={w.status} />{w.acceptedAt && <span>accepted by {w.acceptedBy} {fmtDateTime(w.acceptedAt)}</span>}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {w.publicUrl && <>
            <button className="btn-ghost" onClick={() => { void navigator.clipboard.writeText(w.publicUrl!); toast.success("Link copied"); }}><Copy size={14} /> Copy link</button>
            <a className="btn-ghost" href={w.publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Their copy</a>
          </>}
          {open && dirty && <button className="btn-outline" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? <Spinner /> : <Check size={14} />} Save</button>}
          {w.status === "DRAFT" && <button className="btn-outline" disabled={!!busy} onClick={() => void event("MARK_SENT", {}, "Marked sent. Copy the link to share it.")}>Mark sent</button>}
          {(w.status === "DRAFT" || w.status === "SENT" || w.status === "ACCEPTED") && <button className={w.status === "DRAFT" ? "btn-primary" : "btn-ghost"} onClick={() => setSend(true)}><Send size={14} /> {w.sentAt ? "Email again" : "Email it"}</button>}
          {w.status === "SENT" && <button className="btn-outline" disabled={!!busy} onClick={() => void event("MARK_ACCEPTED", {}, "Accepted")}>Mark accepted</button>}
          {(w.status === "SENT" || w.status === "ACCEPTED") && <button className="btn-primary" disabled={!!busy} onClick={() => void event("DONE", {}, "Done")}><CheckCircle2 size={14} /> Done</button>}
          {w.status !== "DRAFT" && w.status !== "CANCELLED" && <Link className="btn-outline" href={`/avl/purchasing/bill?new=1&wo=${w.id}`}><Receipt size={14} /> Enter bill</Link>}
          {(w.status === "CANCELLED" || w.status === "DONE") && <button className="btn-ghost" onClick={() => void event("REOPEN", {}, "Reopened")}><RotateCcw size={14} /> Reopen</button>}
        </div>
      </div>

      <Facts items={[["Amount", <span key="a" className="font-mono font-semibold">{fmtMoney(open ? total : w.totalCents)}</span>], ["Starts", day(w.startDate)], ["Due", day(w.dueDate)], ["Emailed", w.sentAt && w.sentTo ? `${fmtDateTime(w.sentAt)} to ${w.sentTo}` : w.sentAt ? fmtDateTime(w.sentAt) : null], ["Billed", w.bills.length ? fmtMoney(w.billedCents) : null]]} />

      <Card eyebrow="Work order" title="Who and what">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Title" className="sm:col-span-2"><input className="input" disabled={!open} value={draft.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Subcontractor (vendor)"><select className="input" disabled={!open} value={draft.vendorId ?? ""} onChange={(e) => set({ vendorId: e.target.value || null })}><option value="">Not a vendor in Sundays</option>{d.data.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          <Field label="Contact name"><input className="input" disabled={!open} value={draft.assigneeName ?? ""} onChange={(e) => set({ assigneeName: e.target.value || null })} placeholder="Who's doing the work" /></Field>
          <Field label="Contact email"><input type="email" className="input" disabled={!open} value={draft.assigneeEmail ?? ""} onChange={(e) => set({ assigneeEmail: e.target.value || null })} /></Field>
          <Field label="Starts"><input type="date" className="input" disabled={!open} value={draft.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value || null })} /></Field>
          <Field label="Due"><input type="date" className="input" disabled={!open} value={draft.dueDate ?? ""} onChange={(e) => set({ dueDate: e.target.value || null })} /></Field>
          <Field label="Scope" className="sm:col-span-2 lg:col-span-4"><textarea rows={4} className="input" disabled={!open} value={draft.scope ?? ""} onChange={(e) => set({ scope: e.target.value || null })} placeholder="What's to be done, where, and anything they need to know on site" /></Field>
        </div>
      </Card>

      <Card eyebrow="Cost" title="What you'll pay" action={open && <button className="btn-ghost text-xs" onClick={() => set({ lines: [...draft.lines, { key: k(), budgetItemId: null, description: "", quantity: 1, unit: null, unitCostCents: 0 }] })}><Plus size={13} /> Line</button>}>
        <Table min={720} head={<tr><th>Description</th><th className="w-60">Job budget line</th><th className="w-24">Qty</th><th className="w-32 text-right">Unit cost</th><th className="w-28 text-right">Amount</th><th className="w-10" /></tr>}>
          {draft.lines.map((l) => (
            <tr key={l.key}>
              <td><input className="input py-1" disabled={!open} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="e.g. Two 20A circuits at the rack" /></td>
              <td><BudgetItemSelect items={d.data!.budget} disabled={!open} value={l.budgetItemId} onChange={(v) => setLine(l.key, { budgetItemId: v })} /></td>
              <td><input type="number" step="any" min={0} className="input min-w-[5.5rem] py-1 tabular-nums" disabled={!open} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: Math.max(0, Number(e.target.value) || 0) })} /></td>
              <td><MoneyInput cents={l.unitCostCents} disabled={!open} onChange={(c) => setLine(l.key, { unitCostCents: c ?? 0 })} /></td>
              <td className="text-right font-mono">{fmtMoney(Math.round(l.quantity * l.unitCostCents))}</td>
              <td>{open && <button className="p-1 text-ink-faint hover:text-bad" onClick={() => set({ lines: draft.lines.filter((x) => x.key !== l.key) })}><X size={14} /></button>}</td>
            </tr>
          ))}
          {!draft.lines.length && <tr><td colSpan={6} className="py-8 text-center text-sm text-ink-faint">No cost lines yet. Add one so the job's budget knows what this work order commits.</td></tr>}
        </Table>
        <div className="flex justify-end gap-4 border-t border-line px-4 py-3 text-[15px] font-semibold"><span>Total</span><span className="font-mono">{fmtMoney(total)}</span></div>
      </Card>

      {w.bills.length > 0 && (
        <Card eyebrow="Bills" title="What they've billed">
          <div className="divide-y divide-line">{w.bills.map((b) => (
            <Link key={b.id} href={`/avl/purchasing/bill?id=${b.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-hover/40">
              <span className="font-medium">{b.billNumber ? `Bill ${b.billNumber}` : "Bill"} <span className="text-xs font-normal text-ink-muted">{day(b.billDate)}</span></span>
              <span className="flex items-center gap-2"><BillPill s={b.status} /><span className="font-mono">{fmtMoney(b.totalCents)}</span></span>
            </Link>
          ))}</div>
        </Card>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          {open && w.status !== "DRAFT" && <button className="btn-ghost text-bad" onClick={() => { if (window.confirm(`Cancel ${w.number}? Its cost comes off the job.`)) void event("CANCEL", {}, "Cancelled"); }}>Cancel work order</button>}
          {(w.status === "DRAFT" || w.status === "CANCELLED") && <button className="btn-ghost text-bad" onClick={async () => { if (!window.confirm(`Delete ${w.number}?`)) return; try { await ops(`/work-orders/${id}`, { method: "DELETE" }); void refresh(); router.push(back); } catch (e) { toast.error((e as Error).message); } }}><Trash2 size={14} /> Delete</button>}
        </div>
        {open && dirty && <button className="btn-primary" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? <Spinner /> : <Check size={14} />} Save changes</button>}
      </div>

      {send && <SendModal title={`Email ${w.number}`} defaultTo={w.sentTo ?? draft.assigneeEmail ?? vendorEmail} button={w.sentAt ? "Send again" : "Send"}
        intro={<>They get a link to the work order, where they can read the scope and accept it. You'll get an email when they do.</>}
        onSend={async (to) => { await event("SEND", { emailTo: to }); setSend(false); toast.success(`Sent to ${to}`); }} onClose={() => setSend(false)} />}
    </div>
  );
}
