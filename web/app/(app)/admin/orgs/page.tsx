"use client";
/** Every organization: search, filter, and create one for someone (optionally with a full license). */
import clsx from "clsx";
import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ORG_STATUS_LABEL, ORG_TYPES, type OrgStatus, type OrgType } from "@shared/ops/billing";
import type { AdminOrgRow, PublicPricing } from "@shared/ops/types";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Check, ErrorBox, Field, Loading, PageHeader } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";
import { OrgTable } from "@/components/ops/AdminUi";

export default function Page() { return <Suspense><Orgs /></Suspense>; }

const STATUSES: (OrgStatus | "")[] = ["", "TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"];

function Orgs() {
  const sp = useSearchParams();
  const router = useRouter();
  const status = sp.get("status") ?? "";
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [adding, setAdding] = useState(false);
  const d = useOps<AdminOrgRow[]>(`/platform/orgs?${new URLSearchParams({ ...(status ? { status } : {}), ...(sp.get("q") ? { q: sp.get("q")! } : {}) })}`, { placeholderData: (p) => p });
  const go = (p: Record<string, string>) => { const n = new URLSearchParams({ status, q: sp.get("q") ?? "", ...p }); for (const [k, v] of [...n.entries()]) if (!v) n.delete(k); router.replace(`/admin/orgs?${n}`); };
  return (
    <>
      <PageHeader crumb="Sundays admin" title="Organizations" description="Open one to change its plan, modules, discounts or status."
        actions={<button className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> New organization</button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-line p-0.5">
          {STATUSES.map((s) => (
            <button key={s || "all"} onClick={() => go({ status: s })} className={clsx("rounded-md px-3 py-1.5 text-xs font-medium", status === s ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-hover")}>{s ? ORG_STATUS_LABEL[s] : "All"}</button>
          ))}
        </div>
        <form className="ml-auto w-full sm:w-auto" onSubmit={(e) => { e.preventDefault(); go({ q }); }}>
          <input className="input sm:w-64" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </div>
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : <Card><OrgTable rows={d.data} /></Card>}
      {adding && <NewOrg onClose={() => setAdding(false)} />}
    </>
  );
}

function NewOrg({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const cat = useOps<{ plans: PublicPricing["plans"] }>("/platform/catalog");
  const [f, setF] = useState({ name: "", orgType: "CHURCH" as OrgType, planId: "", fullLicense: false, ownerName: "", ownerEmail: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="New organization" width={560}>
      <form className="space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          const r = await ops<{ id: string }>("/platform/orgs", { json: { ...f, planId: f.planId || null } });
          void refresh(); router.push(`/admin/orgs/view?id=${r.id}`);
        } catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Name"><input required autoFocus className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Type"><select className="input" value={f.orgType} onChange={(e) => setF({ ...f, orgType: e.target.value as OrgType })}>{ORG_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></Field>
        </div>
        <Field label="Plan"><select className="input" value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
          <option value="">Default plan</option>{cat.data?.plans.map((p) => <option key={p.id} value={p.id}>{p.name}{!p.active ? " (inactive)" : ""}</option>)}
        </select></Field>
        <Check label="Full license" hint="Every module, no charge, no trial." checked={f.fullLicense} onChange={(v) => setF({ ...f, fullLicense: v })} />
        <div className="space-y-2 rounded-lg border border-line bg-canvas/50 p-3">
          <span className="label block">Their System admin (optional)</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input" placeholder="Name" value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} />
            <input type="email" className="input" placeholder="Email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} />
          </div>
          <p className="text-[11px] text-ink-faint">They&apos;re straight in when they create their Sundays account (or sign in) with this email.</p>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Create</button></div>
      </form>
    </Modal>
  );
}
