"use client";
/** Small pieces shared by the purchasing screens: status pills, pickers, the send box. */
import clsx from "clsx";
import { Mail, Send } from "lucide-react";
import { useState } from "react";
import type { BudgetItem } from "@shared/ops/jobs";
import { billStatus, coStatus, poStatus, woStatus, type BillStatus, type CoStatus, type CostLink, type PoStatus, type WoStatus } from "@shared/ops/purchasing";
import { budgetRows } from "@shared/ops/jobs";
import { Pill } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";

export const PoPill = ({ s }: { s: PoStatus }) => { const x = poStatus(s); return <Pill tone={x.tone}>{x.label}</Pill>; };
export const WoPill = ({ s }: { s: WoStatus }) => { const x = woStatus(s); return <Pill tone={x.tone}>{x.label}</Pill>; };
export const BillPill = ({ s, overdue }: { s: BillStatus; overdue?: boolean }) => { const x = billStatus(s); return <Pill tone={overdue ? "bad" : x.tone}>{overdue ? "Overdue" : x.label}</Pill>; };
export const CoPill = ({ s }: { s: CoStatus }) => { const x = coStatus(s); return <Pill tone={x.tone}>{x.label}</Pill>; };

/** Pick a budget item of the job (shown under its group). */
export function BudgetItemSelect({ items, value, onChange, disabled, className, empty = "Not on the budget" }: { items: BudgetItem[]; value: string | null; onChange: (id: string | null) => void; disabled?: boolean; className?: string; empty?: string }) {
  const rows = budgetRows(items);
  return (
    <select className={clsx("input py-1 text-xs", className)} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{empty}</option>
      {rows.map(({ item, depth }) => item.kind === "GROUP"
        ? <option key={item.id} disabled value={`g-${item.id}`}>{"  ".repeat(depth)}{item.name}</option>
        : <option key={item.id} value={item.id}>{" ".repeat(depth * 3)}{item.name}</option>)}
    </select>
  );
}

/** Where a document's line points: a link per paper (PO, bill, change order…). */
export function LinkChips({ links }: { links: CostLink[] }) {
  if (!links.length) return null;
  const href = (l: CostLink) => ({
    PROPOSAL: `/avl/quotes/view?id=${l.id}`, CHANGE_ORDER: `/avl/jobs/change-order?id=${l.id}`, PO: `/avl/purchasing/po?id=${l.id}`,
    WORK_ORDER: `/avl/purchasing/wo?id=${l.id}`, BILL: `/avl/purchasing/bill?id=${l.id}`,
  })[l.kind];
  const seen = new Set<string>();
  return (
    <span className="flex flex-wrap items-center gap-x-1 text-[11px] text-ink-faint">
      {links.filter((l) => !seen.has(l.id) && seen.add(l.id)).map((l, i) => (
        <span key={l.id} className="inline-flex items-center gap-1">{i > 0 && <span>→</span>}<a href={href(l)} className="hover:text-accent hover:underline">{l.label}</a></span>
      ))}
    </span>
  );
}

/** "Email it": who to, then send. The server says why if the email can't go. */
export function SendModal({ title, defaultTo, intro, button, onSend, onClose }: { title: string; defaultTo: string | null; intro: React.ReactNode; button: string; onSend: (to: string) => Promise<void>; onClose: () => void }) {
  const [to, setTo] = useState(defaultTo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={title} width={480}>
      <form className="space-y-3 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { await onSend(to.trim()); } catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <p className="text-sm text-ink-soft">{intro}</p>
        <label className="block"><span className="label mb-1.5 block">Email to</span>
          <div className="relative"><Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" /><input type="email" required className="input pl-8" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" /></div>
        </label>
        {error && <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2 pt-1"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? <Spinner /> : <Send size={14} />} {button}</button></div>
      </form>
    </Modal>
  );
}

/** Ask for a short note (sending back, recording an approval). */
export function NoteModal({ title, label, placeholder, button, onSave, onClose, danger }: { title: string; label: string; placeholder?: string; button: string; onSave: (note: string) => Promise<void>; onClose: () => void; danger?: boolean }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={title} width={480}>
      <form className="space-y-3 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { await onSave(note.trim()); } catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <label className="block"><span className="label mb-1.5 block">{label}</span><textarea required rows={4} className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} autoFocus /></label>
        {error && <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className={danger ? "btn-outline text-bad" : "btn-primary"} disabled={busy}>{busy && <Spinner />} {button}</button></div>
      </form>
    </Modal>
  );
}

/** A row of facts under a document's title. */
export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <div className="panel grid gap-px overflow-hidden bg-line sm:grid-cols-2 lg:grid-cols-4">
      {shown.map(([k, v]) => <div key={k} className="bg-surface px-4 py-2.5"><div className="text-[11px] text-ink-muted">{k}</div><div className="text-sm">{v}</div></div>)}
    </div>
  );
}

export const day = (d: string | null) => (d ? new Date(d + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
