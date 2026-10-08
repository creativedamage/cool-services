"use client";
/** Adding and editing a lead, and closing one (won makes the job; lost keeps the reason). */
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { leadName, type LeadDetail, type LeadRow, type LeadStage, type Ref } from "@shared/ops/crm";
import { ops, useOpsRefresh } from "@/lib/ops";
import { useOpsUser } from "@/components/ops/context";
import { Check, Field, MoneyInput } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";
import { dayToIso } from "./ActivityFeed";

export interface LeadForm {
  title: string; customerId: string; orgName: string; contactName: string; contactEmail: string; contactPhone: string; city: string; state: string;
  valueCents: number; source: string; ownerId: string; expectedClose: string; notes: string;
}
export const leadForm = (l?: LeadDetail | null, me = ""): LeadForm => ({
  title: l?.title ?? "", customerId: l?.customerId ?? "", orgName: l?.orgName ?? "", contactName: l?.contactName ?? "", contactEmail: l?.contactEmail ?? "",
  contactPhone: l?.contactPhone ?? "", city: l?.city ?? "", state: l?.state ?? "", valueCents: l?.valueCents ?? 0, source: l?.source ?? "",
  ownerId: l?.ownerId ?? me, expectedClose: l?.expectedClose ?? "", notes: l?.notes ?? "",
});

/** The lead's fields; `isNew` adds a first note and follow-up. */
export function LeadFields({ f, set, customers, people, sources }: { f: LeadForm; set: (p: Partial<LeadForm>) => void; customers: Ref[]; people: Ref[]; sources: string[] }) {
  const [existing, setExisting] = useState(!!f.customerId);
  return (
    <>
      <Field label="What they want"><input required autoFocus className="input" value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Sanctuary audio upgrade" /></Field>
      <div>
        <div className="mb-1.5 flex items-center gap-1">
          <span className="label mr-2">Church</span>
          {[["New church", false], ["A client already", true]].map(([l, v]) => (
            <button key={String(l)} type="button" onClick={() => { setExisting(v as boolean); if (!v) set({ customerId: "" }); }}
              className={clsx("rounded-md px-2 py-0.5 text-[11px] font-medium", existing === v ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-hover")}>{l as string}</button>
          ))}
        </div>
        {existing ? (
          <select required className="input" value={f.customerId} onChange={(e) => set({ customerId: e.target.value })}>
            <option value="">Pick a client…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : <input required className="input" value={f.orgName} onChange={(e) => set({ orgName: e.target.value })} placeholder="Church name" />}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Contact"><input className="input" value={f.contactName} onChange={(e) => set({ contactName: e.target.value })} placeholder="Name" /></Field>
        <Field label="Email"><input type="email" className="input" value={f.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={f.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1.4fr_0.6fr_1fr]">
        <Field label="City"><input className="input" value={f.city} onChange={(e) => set({ city: e.target.value })} /></Field>
        <Field label="State"><input className="input" value={f.state} onChange={(e) => set({ state: e.target.value })} /></Field>
        <Field label="Worth about"><MoneyInput cents={f.valueCents} onChange={(c) => set({ valueCents: c ?? 0 })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Came from">
          <input className="input" list="lead-sources" value={f.source} onChange={(e) => set({ source: e.target.value })} placeholder="Referral, website…" />
          <datalist id="lead-sources">{sources.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="Owner">
          <select className="input" value={f.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
            <option value="">Nobody yet</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Expect to decide by"><input type="date" className="input" value={f.expectedClose} onChange={(e) => set({ expectedClose: e.target.value })} /></Field>
      </div>
    </>
  );
}

const body = (f: LeadForm) => ({ ...f, customerId: f.customerId || null, orgName: f.customerId ? null : f.orgName });

export function NewLeadModal({ customers, people, sources, presetClient, onClose }: { customers: Ref[]; people: Ref[]; sources: string[]; presetClient?: string | null; onClose: () => void }) {
  const me = useOpsUser();
  const router = useRouter();
  const refresh = useOpsRefresh();
  const [f, setF] = useState<LeadForm>({ ...leadForm(null, me.user.id), customerId: presetClient ?? "" });
  const [note, setNote] = useState("");
  const [fu, setFu] = useState(true);
  const [day, setDay] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().slice(0, 10); });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="New lead" width={640}>
      <form className="space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          const r = await ops<{ id: string }>("/leads", { json: { ...body(f), note, followUp: fu ? { body: "Follow up", dueAt: dayToIso(day) } : null } });
          await refresh();
          toast.success("Lead added");
          router.push(`/avl/leads/view?id=${r.id}`);
        } catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <LeadFields f={f} set={(p) => setF({ ...f, ...p })} customers={customers} people={people} sources={sources} />
        <Field label="First note (optional)"><textarea rows={2} className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="How they found you, what they mentioned…" /></Field>
        <div className="flex flex-wrap items-center gap-3">
          <Check label="Remind me to follow up" checked={fu} onChange={setFu} />
          {fu && <input type="date" className="input w-auto py-1.5 text-xs" value={day} onChange={(e) => setDay(e.target.value)} />}
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy && <Spinner />}Add lead</button>
        </div>
      </form>
    </Modal>
  );
}

export function EditLeadModal({ lead, customers, people, sources, onClose }: { lead: LeadDetail; customers: Ref[]; people: Ref[]; sources: string[]; onClose: () => void }) {
  const refresh = useOpsRefresh();
  const [f, setF] = useState<LeadForm>(leadForm(lead));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="Edit lead" width={640}>
      <form className="space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { await ops(`/leads/${lead.id}`, { method: "PUT", json: body(f) }); await refresh(); toast.success("Saved"); onClose(); }
        catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <LeadFields f={f} set={(p) => setF({ ...f, ...p })} customers={customers} people={people} sources={sources} />
        <Field label="Notes (only your team sees these)"><textarea rows={3} className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save</button>
        </div>
      </form>
    </Modal>
  );
}

const LOST_REASONS = ["Went with another integrator", "Budget", "Timing — maybe later", "No response", "Doing it themselves"];

/**
 * Close a lead as won or lost (from the board or its page). Won offers to make the job now: from the
 * proposal when the client has accepted it, otherwise with the usual cost groups.
 */
export function CloseLeadModal({ lead, stage, position, onClose, onDone }: { lead: LeadRow; stage: Extract<LeadStage, "WON" | "LOST">; position?: number | null; onClose: () => void; onDone?: () => void }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const [createJob, setCreateJob] = useState(!lead.job);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signed = lead.quote && ["ACCEPTED", "CONVERTED"].includes(lead.quote.status);
  const won = stage === "WON";
  return (
    <Modal open onClose={onClose} title={won ? `Won: ${lead.title}` : `Lost: ${lead.title}`} width={520}>
      <form className="space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          const r = await ops<{ job: { id: string; number: string } | null }>(`/leads/${lead.id}/move`, { json: { stage, position: position ?? null, lostReason: won ? null : reason.trim() || null, createJob: won && createJob } });
          await refresh();
          onDone?.();
          if (won && createJob && r.job && !lead.job) { toast.success(`Job ${r.job.number} created`); router.push(`/avl/jobs/view?id=${r.job.id}`); }
          else { toast.success(won ? "Marked won" : "Marked lost"); onClose(); }
        } catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        {won ? (
          <>
            <p className="text-sm text-ink-soft">Nice work. {leadName(lead)} is a go.</p>
            {lead.job ? <p className="text-sm text-ink-muted">It already has job {lead.job.number}.</p> : (
              <Check label="Create the job now" checked={createJob} onChange={setCreateJob}
                hint={signed ? `Its budget starts from proposal ${lead.quote!.number}, as signed.`
                  : lead.quote ? `Proposal ${lead.quote.number} isn't signed yet, so the job starts with the usual cost groups. To start from the proposal, mark it accepted on its page first.`
                  : `The job starts with the usual cost groups${lead.customer ? "" : `, and ${leadName(lead)} becomes a client`}.`} />
            )}
          </>
        ) : (
          <>
            <Field label="Why? (helps later)">
              <textarea rows={2} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What happened?" />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {LOST_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={clsx("rounded-full border px-2.5 py-1 text-[11px]", reason === r ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-soft hover:bg-hover")}>{r}</button>)}
            </div>
          </>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className={won ? "btn-primary" : "btn-outline"} disabled={busy}>{busy && <Spinner />}{won ? (createJob && !lead.job ? "Mark won and create job" : "Mark won") : "Mark lost"}</button>
        </div>
      </form>
    </Modal>
  );
}
