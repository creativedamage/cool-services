"use client";
/** The quote builder: line items from vendor price lists, margins, totals, and the quote's life. */
import clsx from "clsx";
import { ArrowDown, ArrowLeft, ArrowUp, Printer, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { computeTotals, lineTotals, priceForMargin } from "@shared/ops/math";
import { availableEvents, isDeletable, isEditable, type QuoteEventType } from "@shared/ops/state-machine";
import type { CatalogProduct, LineItemDraft, QuoteDTO, QuotePage } from "@shared/ops/types";
import { fmtMoney, fmtPct, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { ErrorBox, Field, Loading, MoneyInput, PercentInput, QuoteStatusBadge } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";

const SECTIONS = ["Audio", "Video", "Lighting", "Rigging", "Cable & Connectivity", "Control", "Labor", "Misc"];
const uid = () => Math.random().toString(36).slice(2, 10);

export default function Page() { return <Suspense><QuoteView /></Suspense>; }

function QuoteView() {
  const id = useSearchParams().get("id") ?? "";
  const d = useOps<QuotePage>(id ? `/quotes/${id}` : null);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  return <Builder key={`${d.data.quote.status}:${d.data.quote.events[0]?.id ?? ""}`} page={d.data} />;
}

function Builder({ page }: { page: QuotePage }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const { customers, vendors, defaultMarginBps, laborRateCents, canApprove } = page;
  const [q, setQ] = useState<QuoteDTO>(page.quote);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [askNote, setAskNote] = useState<QuoteEventType | null>(null);
  const editable = isEditable(q.status);
  const customer = customers.find((c) => c.id === q.customerId);
  const totals = useMemo(() => computeTotals(q.items, { taxBps: q.taxBps, discountCents: q.discountCents, depositBps: q.depositBps, taxExempt: customer?.taxExempt }),
    [q.items, q.taxBps, q.discountCents, q.depositBps, customer?.taxExempt]);

  const patch = (p: Partial<QuoteDTO>) => { setQ((prev) => ({ ...prev, ...p })); setDirty(true); };
  const patchItem = (key: string, p: Partial<LineItemDraft>) => patch({ items: q.items.map((i) => (i.key === key ? { ...i, ...p } : i)) });
  const move = (key: string, dir: -1 | 1) => {
    const i = q.items.findIndex((x) => x.key === key), j = i + dir;
    if (j < 0 || j >= q.items.length) return;
    const items = [...q.items]; [items[i], items[j]] = [items[j], items[i]]; patch({ items });
  };
  const addFromCatalog = (p: CatalogProduct, qty: number) => {
    setQ((prev) => {
      const existing = prev.items.find((i) => i.productId === p.id);
      const items = existing ? prev.items.map((i) => (i === existing ? { ...i, quantity: i.quantity + qty } : i)) : [...prev.items, {
        key: uid(), productId: p.id, isCustom: false, section: guessSection(p.category), sku: p.sku, name: [p.manufacturer, p.name].filter(Boolean).join(" "),
        description: p.model ? `Model ${p.model}` : p.description, quantity: qty, unitCostCents: p.costCents, unitPriceCents: priceForMargin(p.costCents, defaultMarginBps), taxable: true,
      }];
      return { ...prev, items };
    });
    setDirty(true);
  };
  const addCustom = (kind: "item" | "labor") => patch({ items: [...q.items, kind === "labor"
    ? { key: uid(), productId: null, isCustom: true, section: "Labor", sku: null, name: "Installation labor (hours)", description: null, quantity: 1, unitCostCents: 0, unitPriceCents: laborRateCents, taxable: false }
    : { key: uid(), productId: null, isCustom: true, section: "Misc", sku: null, name: "Custom item", description: null, quantity: 1, unitCostCents: 0, unitPriceCents: 0, taxable: true }] });
  const [marginAll, setMarginAll] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      const saved = await ops<QuoteDTO>(`/quotes/${q.id}`, { method: "PUT", json: {
        title: q.title, customerId: q.customerId, campusId: q.campusId, introNotes: q.introNotes, internalNotes: q.internalNotes, terms: q.terms,
        taxBps: q.taxBps, discountCents: q.discountCents, depositBps: q.depositBps, validUntil: q.validUntil, items: q.items.map(({ key: _k, ...rest }) => rest),
      } });
      setQ(saved); setDirty(false); toast.success("Saved");
      void refresh();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  const events = availableEvents(q.status, "staff").filter((e) => (e !== "CONVERT" && e !== "MARK_ACCEPTED") || canApprove);
  async function fire(event: QuoteEventType, note?: string) {
    if (dirty) return setError("Save your changes first.");
    const confirmText = event === "SEND" ? (q.status === "CHANGES_REQUESTED" ? "Lock the revised pricing for the customer?" : "Lock this pricing for the customer? You can still revise it if they ask for changes.")
      : event === "CONVERT" ? "Mark this sale as converted / fulfilled? This is final." : null;
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      const next = await ops<QuoteDTO>(`/quotes/${q.id}/events`, { json: { event, note } });
      setQ(next); setAskNote(null); toast.success(LABELS[event] ?? "Updated");
      void refresh();
    } catch (e) { setError((e as Error).message); }
  }
  async function remove() {
    if (!window.confirm(`Delete quote ${q.number}? This can't be undone.`)) return;
    try { await ops(`/quotes/${q.id}`, { method: "DELETE" }); void refresh(); router.push("/avl/quotes"); } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="space-y-5">
      <Link href="/avl/quotes" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"><ArrowLeft size={13} /> Quotes</Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 text-sm text-ink-muted"><span className="font-mono">{q.number}</span><QuoteStatusBadge status={q.status} />{dirty && <span className="text-warn">● Unsaved changes</span>}</div>
          <input className="mt-1 w-full border-0 bg-transparent p-0 text-2xl font-semibold tracking-tight focus:outline-none disabled:text-ink" value={q.title} disabled={!editable} onChange={(e) => patch({ title: e.target.value })} />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {editable && <button className="btn-primary" disabled={!dirty || saving} onClick={save}>{saving && <Spinner />}Save</button>}
          {events.map((e) => (
            <button key={e} className={e === "SEND" || e === "MARK_ACCEPTED" ? "btn-primary" : e === "MARK_DECLINED" ? "btn-ghost text-bad" : "btn-outline"}
              onClick={() => (NEEDS_NOTE.includes(e) ? setAskNote(e) : void fire(e))}>{e === "SEND" && q.status === "CHANGES_REQUESTED" ? "Lock revision" : LABELS[e]}</button>
          ))}
          <Link className="btn-outline" href={`/ops-print?id=${q.id}`}><Printer size={14} /> Print / PDF</Link>
          {isDeletable(q.status) && <button className="btn-ghost text-bad" onClick={remove}>Delete</button>}
        </div>
      </div>
      {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      {!editable && (
        <p className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-ink-soft">
          This quote is <b>{q.status.replace("_", " ").toLowerCase()}</b> and locked. The customer's pricing is frozen at {q.sentTotalCents != null ? fmtMoney(q.sentTotalCents) : "send time"}.
          {q.status === "SENT" ? " Print it or save the PDF for the customer, then record their answer here." : q.status === "CHANGES_REQUESTED" ? "" : " Use Revise / Reopen to make changes."}
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div className="panel grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Client" hint={customer?.taxExempt ? "Tax exempt" : undefined}>
              <select className="input" disabled={!editable} value={q.customerId} onChange={(e) => patch({ customerId: e.target.value })}>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.taxExempt ? " (tax exempt)" : ""}</option>)}
              </select>
            </Field>
            <Field label="Client record">
              <Link href={`/avl/clients/view?id=${q.customerId}`} className="btn-outline w-full justify-center">Open {customer?.name ?? "client"} →</Link>
            </Field>
            <Field label="Valid until"><input type="date" className="input" disabled={!editable} value={q.validUntil?.slice(0, 10) ?? ""} onChange={(e) => patch({ validUntil: e.target.value || null })} /></Field>
            <Field label="Deposit to approve"><PercentInput bps={q.depositBps} disabled={!editable} onChange={(depositBps) => patch({ depositBps })} /></Field>
          </div>

          <section className="panel overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
              <div><div className="label">Scope</div><div className="text-[15px] font-semibold">Line items</div></div>
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary" onClick={() => setPicker(true)}>+ From catalog</button>
                  <button className="btn-outline" onClick={() => addCustom("item")}>+ Custom line</button>
                  <button className="btn-outline" onClick={() => addCustom("labor")}>+ Labor</button>
                  <button className="btn-ghost" onClick={() => setMarginAll(String(defaultMarginBps / 100))}>Set margin…</button>
                </div>
              )}
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_th]:px-3 [&_th]:py-2.5">
                  <tr><th className="w-32">Section</th><th>Item</th><th className="w-20">Qty</th><th className="w-32 text-right">Unit cost</th><th className="w-32 text-right">Unit price</th><th className="w-24 text-right">Margin</th><th className="w-28 text-right">Ext. price</th><th className="w-12">Tax</th><th className="w-20" /></tr>
                </thead>
                <tbody className="divide-y divide-line [&_td]:px-3 [&_td]:py-2.5">
                  {q.items.map((it, idx) => {
                    const lt = lineTotals(it);
                    const low = it.unitCostCents > 0 && lt.marginBps < 1500;
                    return (
                      <tr key={it.key} className="align-top">
                        <td><input list="ops-sections" className="input py-1" disabled={!editable} value={it.section ?? ""} onChange={(e) => patchItem(it.key, { section: e.target.value || null })} /></td>
                        <td>
                          <input className="input py-1 font-medium" disabled={!editable} value={it.name} onChange={(e) => patchItem(it.key, { name: e.target.value })} />
                          <input className="input mt-1 py-1 text-xs" placeholder="Description (the customer sees this)" disabled={!editable} value={it.description ?? ""} onChange={(e) => patchItem(it.key, { description: e.target.value || null })} />
                          <div className="mt-1 text-[11px] text-ink-faint">{it.isCustom ? "Custom line" : `Catalog · ${it.sku}`}</div>
                        </td>
                        <td><input type="number" min={1} className="input py-1" disabled={!editable} value={it.quantity} onChange={(e) => patchItem(it.key, { quantity: Math.max(1, parseInt(e.target.value) || 1) })} /></td>
                        <td><MoneyInput cents={it.unitCostCents} disabled={!editable} onChange={(c) => patchItem(it.key, { unitCostCents: c ?? 0 })} /></td>
                        <td><MoneyInput cents={it.unitPriceCents} disabled={!editable} onChange={(c) => patchItem(it.key, { unitPriceCents: c ?? 0 })} /></td>
                        <td>{it.unitCostCents > 0 ? (
                          <div className={clsx(low && "[&_input]:border-warn [&_input]:bg-warn-soft")}>
                            <PercentInput bps={lt.marginBps} disabled={!editable} onChange={(m) => m < 10_000 && patchItem(it.key, { unitPriceCents: priceForMargin(it.unitCostCents, m) })} />
                          </div>
                        ) : <div className="pt-2 text-right text-xs text-ink-faint">—</div>}</td>
                        <td className="pt-4 text-right font-medium tabular-nums">{fmtMoney(lt.priceCents)}</td>
                        <td className="pt-4"><input type="checkbox" disabled={!editable} checked={it.taxable} onChange={(e) => patchItem(it.key, { taxable: e.target.checked })} /></td>
                        <td className="whitespace-nowrap pt-3">{editable && (<>
                          <button className="p-1 text-ink-faint hover:text-ink disabled:opacity-30" disabled={idx === 0} onClick={() => move(it.key, -1)} aria-label="Move up"><ArrowUp size={13} /></button>
                          <button className="p-1 text-ink-faint hover:text-ink disabled:opacity-30" disabled={idx === q.items.length - 1} onClick={() => move(it.key, 1)} aria-label="Move down"><ArrowDown size={13} /></button>
                          <button className="p-1 text-bad/80 hover:text-bad" onClick={() => patch({ items: q.items.filter((x) => x.key !== it.key) })} aria-label="Remove"><X size={13} /></button>
                        </>)}</td>
                      </tr>
                    );
                  })}
                  {!q.items.length && <tr><td colSpan={9} className="py-12 text-center text-ink-faint">No line items yet. Add products from a vendor price list, or a custom line.</td></tr>}
                </tbody>
              </table>
              <datalist id="ops-sections">{SECTIONS.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="panel space-y-3 p-4">
              <Field label="Proposal intro (the customer sees this)"><textarea rows={5} className="input" disabled={!editable} value={q.introNotes ?? ""} onChange={(e) => patch({ introNotes: e.target.value })} /></Field>
              <Field label="Terms & conditions"><textarea rows={5} className="input" disabled={!editable} value={q.terms ?? ""} onChange={(e) => patch({ terms: e.target.value })} /></Field>
            </div>
            <div className="panel p-4">
              <Field label="Internal notes (AVL team only)"><textarea rows={12} className="input border-warn/30" disabled={!editable} value={q.internalNotes ?? ""} onChange={(e) => patch({ internalNotes: e.target.value })} /></Field>
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="panel p-4">
            <div className="label mb-3">Totals</div>
            <dl className="space-y-2 text-sm">
              <Row label="Subtotal" value={fmtMoney(totals.subtotalCents)} />
              <div className="flex items-center justify-between gap-3"><dt className="text-ink-muted">Discount</dt><dd className="w-32"><MoneyInput cents={q.discountCents} disabled={!editable} onChange={(c) => patch({ discountCents: c ?? 0 })} /></dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-ink-muted">Tax rate {customer?.taxExempt && <span className="text-xs text-ok">(exempt)</span>}</dt><dd className="w-32"><PercentInput bps={q.taxBps} disabled={!editable} onChange={(taxBps) => patch({ taxBps })} /></dd></div>
              <Row label="Tax" value={fmtMoney(totals.taxCents)} />
              <div className="border-t border-line pt-2"><Row label={<b>Total</b>} value={<b className="text-xl text-accent">{fmtMoney(totals.totalCents)}</b>} /></div>
              <Row label={`Deposit (${fmtPct(q.depositBps)})`} value={fmtMoney(totals.depositCents)} />
              {q.paidCents > 0 && <Row label="Paid" value={<span className="text-ok">{fmtMoney(q.paidCents)}</span>} />}
            </dl>
          </div>
          <div className="panel p-4">
            <div className="label mb-3">Margin · internal only</div>
            <dl className="space-y-2 text-sm">
              <Row label="Revenue (pre-tax)" value={fmtMoney(totals.subtotalCents - totals.discountCents)} />
              <Row label="Cost" value={fmtMoney(totals.costCents)} />
              <Row label="Gross profit" value={<span className={totals.grossProfitCents < 0 ? "text-bad" : "text-ok"}>{fmtMoney(totals.grossProfitCents)}</span>} />
              <Row label="Margin" value={fmtPct(totals.marginBps)} />
              <Row label="Markup" value={fmtPct(totals.markupBps)} />
            </dl>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-hover" title="Aim for 25% or more">
              <div className={clsx("h-full rounded-full", totals.marginBps < 1500 ? "bg-bad" : totals.marginBps < 2500 ? "bg-warn" : "bg-ok")} style={{ width: `${Math.max(0, Math.min(100, totals.marginBps / 100))}%` }} />
            </div>
          </div>
          {q.events.length > 0 && (
            <div className="panel p-4">
              <div className="label mb-3">Activity</div>
              <ol className="space-y-3 text-sm">
                {q.events.map((e) => (
                  <li key={e.id} className="border-l-2 border-line pl-3">
                    <div className="font-medium">{(LABELS[e.type as QuoteEventType] ?? e.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()))}
                      {e.toStatus && e.fromStatus !== e.toStatus && <span className="text-ink-faint"> → {e.toStatus.replace("_", " ").toLowerCase()}</span>}</div>
                    {e.note && <div className="whitespace-pre-wrap text-ink-soft">{e.note}</div>}
                    <div className="text-xs text-ink-faint">{e.actorLabel ?? "Staff"} · {new Date(e.createdAt).toLocaleString()}</div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>

      {picker && <CatalogPicker vendors={vendors} onAdd={addFromCatalog} onClose={() => setPicker(false)} />}
      {askNote && <NoteModal event={askNote} onClose={() => setAskNote(null)} onSubmit={(n) => fire(askNote, n)} />}
      {marginAll !== null && (
        <Modal open onClose={() => setMarginAll(null)} title="Margin for every product line" width={380}>
          <form className="space-y-3 p-5" onSubmit={(e) => {
            e.preventDefault();
            const n = parseFloat(marginAll);
            if (Number.isFinite(n) && n < 100) patch({ items: q.items.map((i) => (i.unitCostCents > 0 ? { ...i, unitPriceCents: priceForMargin(i.unitCostCents, Math.round(n * 100)) } : i)) });
            setMarginAll(null);
          }}>
            <Field label="Target margin %"><input autoFocus className="input" inputMode="decimal" value={marginAll} onChange={(e) => setMarginAll(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setMarginAll(null)}>Cancel</button><button className="btn-primary">Apply</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const LABELS: Partial<Record<QuoteEventType | "CREATE" | "EDIT", string>> = {
  SEND: "Lock & mark sent", REVISE: "Revise (back to draft)", REOPEN: "Reopen as draft", CONVERT: "Mark converted",
  MARK_ACCEPTED: "Customer accepted", MARK_CHANGES: "Customer wants changes", MARK_DECLINED: "Customer declined", CREATE: "Created", EDIT: "Edited",
};
const NEEDS_NOTE: QuoteEventType[] = ["MARK_ACCEPTED", "MARK_CHANGES", "MARK_DECLINED"];

function NoteModal({ event, onClose, onSubmit }: { event: QuoteEventType; onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const prompt = event === "MARK_ACCEPTED" ? "How did the customer accept? (e.g. signed the printed proposal on Oct 4)" : event === "MARK_CHANGES" ? "What changes did they ask for?" : "Anything to note? (optional)";
  return (
    <Modal open onClose={onClose} title={LABELS[event]} width={460}>
      <form className="space-y-3 p-5" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(note); setBusy(false); }}>
        <Field label="Note"><textarea autoFocus rows={3} className="input" placeholder={prompt} value={note} onChange={(e) => setNote(e.target.value)} required={event !== "MARK_DECLINED"} /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}{LABELS[event]}</button></div>
      </form>
    </Modal>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-ink-muted">{label}</dt><dd className="tabular-nums">{value}</dd></div>;
}

/** Search the vendor price lists by SKU / model / name and add to the quote. */
function CatalogPicker({ vendors, onAdd, onClose }: { vendors: { id: string; name: string }[]; onAdd: (p: CatalogProduct, qty: number) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [deb, setDeb] = useState({ q: "", vendorId: "" });
  useEffect(() => { const t = setTimeout(() => setDeb({ q, vendorId }), 200); return () => clearTimeout(t); }, [q, vendorId]);
  const res = useOps<{ products: CatalogProduct[] }>(`/catalog?${new URLSearchParams({ q: deb.q, ...(deb.vendorId ? { vendorId: deb.vendorId } : {}), take: "60" })}`, { placeholderData: (p) => p });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Modal open onClose={onClose} title="Add from vendor price lists" width={900}>
      <div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row">
        <input ref={ref} className="input flex-1" placeholder="Search SKU, model, or product name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input sm:w-56" value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">All vendors</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        <button className="btn-outline" onClick={onClose}>Done</button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_th]:px-4 [&_th]:py-2"><tr><th>Product</th><th>Vendor</th><th className="text-right">Cost</th><th className="text-right">MSRP</th><th className="w-20">Qty</th><th className="w-20" /></tr></thead>
          <tbody className="divide-y divide-line [&_td]:px-4 [&_td]:py-2.5">
            {(res.data?.products ?? []).map((p) => (
              <tr key={p.id} className="hover:bg-hover/40">
                <td><div className="font-medium">{p.name}</div><div className="text-xs text-ink-muted">{[p.manufacturer, p.model, p.sku].filter(Boolean).join(" · ")}</div></td>
                <td className="text-xs">{p.vendor.name}</td>
                <td className="text-right tabular-nums">{fmtMoney(p.costCents)}</td>
                <td className="text-right tabular-nums text-ink-muted">{p.msrpCents != null ? fmtMoney(p.msrpCents) : "—"}</td>
                <td><input type="number" min={1} className="input py-1" value={qty[p.id] ?? 1} onChange={(e) => setQty({ ...qty, [p.id]: Math.max(1, parseInt(e.target.value) || 1) })} /></td>
                <td><button className="btn-primary py-1" onClick={() => { onAdd(p, qty[p.id] ?? 1); setAdded({ ...added, [p.id]: true }); }}>{added[p.id] ? "Add +" : "Add"}</button></td>
              </tr>
            ))}
            {res.data && !res.data.products.length && <tr><td colSpan={6} className="py-10 text-center text-ink-faint">No products found. Import a vendor price list under Vendors.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function guessSection(category: string | null): string | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (/audio|mic|speaker|amp|console|mixer|dsp/.test(c)) return "Audio";
  if (/video|camera|projector|display|led wall|switcher/.test(c)) return "Video";
  if (/light|fixture|dmx|dimmer/.test(c)) return "Lighting";
  if (/rig|truss|mount/.test(c)) return "Rigging";
  if (/cable|connector|snake|network/.test(c)) return "Cable & Connectivity";
  return category;
}
