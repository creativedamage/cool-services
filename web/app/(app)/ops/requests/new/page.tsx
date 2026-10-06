"use client";
/** New request: pick a type, then the details. */
import clsx from "clsx";
import { ArrowRight, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { KIND_LABEL, type RequestKind, type RequestWorkflow } from "@shared/ops/workflow";
import type { CategoryOption } from "@shared/ops/types";
import { fmtMoney, ops, useOps, useOpsMe, useOpsRefresh } from "@/lib/ops";
import { ErrorBox, Field, Loading, MoneyInput, PageHeader } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";
import { TypeIcon } from "@/components/ops/TypeIcon";
import Link from "next/link";

const KIND_BLURB: Record<RequestKind, string> = {
  TECHNOLOGY: "Laptops, iPads, phones, software and accessories",
  SUPPLY: "Restroom, janitorial, kitchen and office supplies",
  MAINTENANCE: "Repairs and building issues: plumbing, ceilings, HVAC, doors",
  OTHER: "Anything else",
};
const WORKFLOW_HINT: Record<RequestWorkflow, string> = { APPROVAL: "Needs approval", FULFILLMENT: "Goes straight to the team", WORK_ORDER: "Creates a work order" };

export default function NewRequest() {
  const me = useOpsMe();
  const canAdd = me.data?.status === "ok" && me.data.nav.manager && me.data.user.allCampuses;
  const data = useOps<{ categories: CategoryOption[]; campuses: { id: string; name: string }[]; defaultCampusId: string | null }>("/requests/new");
  const [catId, setCatId] = useState<string | null>(null);
  if (!data.data) return <><PageHeader crumb="Requests / New" title="New request" /><ErrorBox error={data.error} />{!data.error && <Loading />}</>;
  const { categories, campuses, defaultCampusId } = data.data;
  const cat = categories.find((c) => c.id === catId) ?? null;
  const kinds = (["TECHNOLOGY", "SUPPLY", "MAINTENANCE", "OTHER"] as RequestKind[]).filter((k) => categories.some((c) => c.kind === k));
  return (
    <>
      <PageHeader crumb="Requests / New" title="New request" description="Technology, supplies, or anything in the building that needs attention." />
      {!cat ? (
        <div className="space-y-7">
          {kinds.map((k) => {
            return (
              <section key={k}>
                <div className="mb-2.5 flex items-baseline gap-3"><h2 className="text-[15px] font-semibold">{KIND_LABEL[k]}</h2><span className="text-xs text-ink-muted">{KIND_BLURB[k]}</span></div>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {categories.filter((c) => c.kind === k).map((c) => (
                    <button key={c.id} onClick={() => setCatId(c.id)} className="panel group flex items-start gap-3 p-3.5 text-left transition hover:border-accent/50 hover:bg-hover/40">
                      <TypeIcon icon={c.icon} kind={c.kind} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{c.name}</span>
                        {c.description && <span className="mt-0.5 block text-xs text-ink-muted">{c.description}</span>}
                        <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{WORKFLOW_HINT[c.workflow]}</span>
                      </span>
                      <ArrowRight size={14} className="mt-1 text-ink-faint group-hover:text-accent" />
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
          {canAdd && (
            <Link href="/ops/settings/request-types?add=1" className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong p-3.5 text-sm text-ink-muted transition hover:border-accent/60 hover:text-accent">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-hover"><Plus size={16} /></span>Add a request type
            </Link>
          )}
          {!categories.length && <p className="text-sm text-ink-muted">No request types are set up yet. A manager can add them under Settings → Request types.</p>}
          {!campuses.length && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">No campuses yet. A manager needs to add one under Settings → Campuses before requests can be made.</p>}
        </div>
      ) : <RequestForm cat={cat} campuses={campuses} defaultCampusId={defaultCampusId} onBack={() => setCatId(null)} />}
    </>
  );
}

function RequestForm({ cat, campuses, defaultCampusId, onBack }: { cat: CategoryOption; campuses: { id: string; name: string }[]; defaultCampusId: string | null; onBack: () => void }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const [f, setF] = useState({
    campusId: defaultCampusId && campuses.some((c) => c.id === defaultCampusId) ? defaultCampusId : campuses[0]?.id ?? "",
    title: cat.allowLineItems ? `${cat.name} restock` : "", details: "", location: "", quantity: 1, unitEstimateCents: 0 as number | null, neededBy: "", priority: "NORMAL",
  });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [extra, setExtra] = useState<{ description: string; quantity: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supplyTotal = useMemo(() => cat.supplyItems.reduce((s, i) => s + (i.unitCostCents ?? 0) * (qty[i.id] ?? 0), 0), [cat, qty]);
  const isTech = cat.kind === "TECHNOLOGY";
  const isMaint = cat.workflow === "WORK_ORDER";
  const threshold = cat.approvalThresholdCents;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const lines = cat.allowLineItems
        ? [...Object.entries(qty).filter(([, q]) => q > 0).map(([supplyItemId, quantity]) => ({ supplyItemId, quantity })), ...extra.filter((x) => x.description.trim() && x.quantity > 0)]
        : undefined;
      const d = await ops<{ id: string; number: string }>("/requests", { json: {
        categoryId: cat.id, campusId: f.campusId, title: f.title, details: f.details, location: f.location || null, quantity: f.quantity,
        unitEstimateCents: isTech && f.unitEstimateCents ? f.unitEstimateCents : null, neededBy: f.neededBy || null, priority: f.priority, lines,
      } });
      toast.success(`Request ${d.number} sent`);
      void refresh();
      router.push(`/ops/requests/view?id=${d.id}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="panel">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div><div className="label">{KIND_LABEL[cat.kind]}</div><div className="text-[15px] font-semibold"><span className="flex items-center gap-2"><TypeIcon plain icon={cat.icon} kind={cat.kind} className="text-accent" />{cat.name}</span></div></div>
          <button type="button" className="btn-ghost text-xs" onClick={onBack}>Change type</button>
        </header>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label={isMaint ? "What's the problem?" : "What do you need?"} className="sm:col-span-2">
            <input required className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}
              placeholder={isMaint ? "e.g. Leaking sink in the men's restroom" : isTech ? 'e.g. 13" MacBook Air for worship planning' : "Short summary"} />
          </Field>
          {campuses.length > 1 && (
            <Field label="Campus">
              <select className="input" value={f.campusId} onChange={(e) => setF({ ...f, campusId: e.target.value })}>
                {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          <Field label={`Location ${cat.requiresLocation ? "*" : "(optional)"}`}>
            <input required={cat.requiresLocation} className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Building / room, e.g. Kids wing – room 104" />
          </Field>
          {cat.allowLineItems && (
            <div className="sm:col-span-2">
              <span className="label mb-1.5 block">Items</span>
              <div className="divide-y divide-line rounded-lg border border-line">
                {cat.supplyItems.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="text-sm">{i.name} <span className="text-ink-faint">· per {i.unit}</span></div>
                    <Stepper value={qty[i.id] ?? 0} onChange={(v) => setQty({ ...qty, [i.id]: v })} />
                  </div>
                ))}
                {extra.map((x, idx) => (
                  <div key={idx} className="flex items-center gap-3 px-3 py-2">
                    <input className="input flex-1 py-1.5" placeholder="Other item" value={x.description} onChange={(e) => setExtra(extra.map((y, j) => (j === idx ? { ...y, description: e.target.value } : y)))} />
                    <Stepper value={x.quantity} onChange={(v) => setExtra(extra.map((y, j) => (j === idx ? { ...y, quantity: v } : y)))} />
                  </div>
                ))}
              </div>
              <button type="button" className="mt-2 text-xs text-accent hover:underline" onClick={() => setExtra([...extra, { description: "", quantity: 1 }])}>+ Something not listed</button>
            </div>
          )}
          {isTech && (
            <>
              <Field label="Quantity"><input type="number" min={1} className="input" value={f.quantity} onChange={(e) => setF({ ...f, quantity: Math.max(1, parseInt(e.target.value) || 1) })} /></Field>
              <Field label="Estimated cost each (optional)"><MoneyInput cents={f.unitEstimateCents} onChange={(c) => setF({ ...f, unitEstimateCents: c })} /></Field>
            </>
          )}
          <Field label={isMaint ? "Details" : isTech ? "Why is it needed?" : "Notes"} className="sm:col-span-2">
            <textarea rows={4} required={isTech || isMaint} className="input" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })}
              placeholder={isMaint ? "What's happening, since when, anything already tried…" : isTech ? "Ministry use, who it's for, what it replaces…" : ""} />
          </Field>
          <Field label="Priority">
            <select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              <option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option>
            </select>
          </Field>
          <Field label="Needed by (optional)"><input type="date" className="input" value={f.neededBy} onChange={(e) => setF({ ...f, neededBy: e.target.value })} /></Field>
          {isMaint && f.priority === "URGENT" && (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn sm:col-span-2">For emergencies (active leak, no power, safety hazard) also call the facilities lead directly, then log it here.</p>
          )}
        </div>
      </section>
      <aside className="space-y-4">
        <div className="panel p-4 text-sm">
          <div className="label mb-2">What happens next</div>
          <p className="text-ink-soft">
            {cat.workflow === "APPROVAL" && "Your request goes to an approver first. Once approved, the team orders or fulfills it."}
            {cat.workflow === "FULFILLMENT" && (threshold != null ? `Goes straight to the team. Orders over ${fmtMoney(threshold)} need approval first.` : "Goes straight to the team to fulfill.")}
            {cat.workflow === "WORK_ORDER" && "Creates a work order for the team. You can follow it here as it's assigned and completed."}
          </p>
          {cat.allowLineItems && supplyTotal > 0 && (
            <div className="mt-3 flex justify-between border-t border-line pt-3"><span className="text-ink-muted">Estimated</span><span className="font-mono">{fmtMoney(supplyTotal)}</span></div>
          )}
        </div>
        {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        <button className={clsx("btn-primary w-full py-2.5")} disabled={busy || !f.campusId}>{busy ? <Spinner /> : null}{busy ? "Sending…" : "Submit request"}</button>
      </aside>
    </form>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-line">
      <button type="button" className="px-2 py-1 text-ink-muted hover:text-ink" onClick={() => onChange(Math.max(0, value - 1))}><Minus size={13} /></button>
      <input className="w-10 bg-transparent py-1 text-center font-mono text-sm focus:outline-none" inputMode="numeric" value={value} onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))} />
      <button type="button" className="px-2 py-1 text-ink-muted hover:text-ink" onClick={() => onChange(value + 1)}><Plus size={13} /></button>
    </div>
  );
}
