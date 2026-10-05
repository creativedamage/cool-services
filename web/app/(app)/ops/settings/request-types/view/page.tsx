"use client";
/** A request type: who handles (and approves) it at each campus, its details, and its supply list. */
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import type { RequestKind, RequestWorkflow } from "@shared/ops/workflow";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Check, ErrorBox, Loading, MoneyInput, PageHeader } from "@/components/ops/OpsUi";
import { CategoryFields, type CategoryForm } from "@/components/ops/CategoryFields";

type Cat = { id: string; name: string; icon: string | null; kind: RequestKind; workflow: RequestWorkflow; description: string | null; approvalThresholdCents: number | null; requiresLocation: boolean; allowLineItems: boolean; sortOrder: number; active: boolean };
type Item = { id: string; name: string; unit: string; sku: string | null; unitCostCents: number | null; sortOrder: number; active: boolean };
type Data = {
  category: Cat; routings: { campusId: string | null; handlerTeamId: string; approverTeamId: string | null }[]; supplyItems: Item[];
  rows: { key: string; label: string; campusId: string | null }[]; teams: { id: string; name: string; campusId: string | null }[]; global: boolean; hasFallback: boolean;
};
export default function Page() { return <Suspense><TypeView /></Suspense>; }

function TypeView() {
  const id = useSearchParams().get("id") ?? "";
  const d = useOps<Data>(id ? `/settings/request-types/${id}` : null);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const c = d.data.category;
  return (
    <>
      <PageHeader crumb="Settings / Request types" title={`${c.icon ?? ""} ${c.name}`.trim()} />
      <div className="space-y-5">
        <Routing key={JSON.stringify(d.data.routings)} data={d.data} />
        {d.data.global && <Details key={c.id + c.name + c.active} c={c} />}
        {d.data.global && c.allowLineItems && <Supplies categoryId={c.id} items={d.data.supplyItems} />}
      </div>
    </>
  );
}

function Routing({ data }: { data: Data }) {
  const refresh = useOpsRefresh();
  const c = data.category;
  const needsApprover = c.workflow === "APPROVAL" || (c.workflow === "FULFILLMENT" && c.approvalThresholdCents != null);
  const [rows, setRows] = useState(data.rows.map((r) => {
    const x = data.routings.find((y) => y.campusId === r.campusId);
    return { ...r, handlerTeamId: x?.handlerTeamId ?? "", approverTeamId: x?.approverTeamId ?? "" };
  }));
  const set = (k: string, p: Partial<(typeof rows)[number]>) => setRows(rows.map((r) => (r.key === k ? { ...r, ...p } : r)));
  const opts = <><option value="">—</option>{data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.campusId ? "" : " (all campuses)"}</option>)}</>;
  return (
    <Card eyebrow="Routing" title={data.global ? "Who handles this at each campus" : "Who handles this at your campus"}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        try {
          await ops(`/settings/request-types/${c.id}/routes`, { method: "PUT", json: { rows: rows.map((r) => ({ campusId: r.campusId, handlerTeamId: r.handlerTeamId || null, approverTeamId: r.approverTeamId || null })) } });
          toast.success("Routing saved"); await refresh();
        } catch (err) { toast.error((err as Error).message); }
      }}>
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_th]:px-4 [&_th]:py-2.5"><tr><th>Campus</th><th>Handling team</th>{needsApprover && <th>Approving team</th>}</tr></thead>
          <tbody className="divide-y divide-line [&_td]:px-4 [&_td]:py-2.5">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="font-medium">{r.label}</td>
                <td><select className="input" value={r.handlerTeamId} onChange={(e) => set(r.key, { handlerTeamId: e.target.value })}>{opts}</select></td>
                {needsApprover && <td><select className="input" value={r.approverTeamId} onChange={(e) => set(r.key, { approverTeamId: e.target.value })}>{opts}</select></td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={3} className="py-8 text-center text-ink-faint">Add a campus first (Settings → Campuses).</td></tr>}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center gap-3 border-t border-line p-4">
          <button className="btn-primary">Save routing</button>
          <span className="text-xs text-ink-faint">
            {data.global ? "Leave a campus blank to use the fallback row." : `Blank uses the church-wide default${data.hasFallback ? "" : " (none set; ask a global manager)"}.`}
            {needsApprover && " No approving team = managers at that campus approve."}
          </span>
        </div>
      </form>
    </Card>
  );
}

function Details({ c }: { c: Cat }) {
  const refresh = useOpsRefresh();
  const [f, setF] = useState<CategoryForm>({ ...c, icon: c.icon ?? "", description: c.description ?? "" });
  return (
    <Card eyebrow="Settings" title="Type details">
      <form className="grid gap-4 p-4 md:grid-cols-4" onSubmit={async (e) => {
        e.preventDefault();
        try { await ops(`/settings/request-types/${c.id}`, { method: "PUT", json: f }); toast.success("Saved"); await refresh(); } catch (err) { toast.error((err as Error).message); }
      }}>
        <CategoryFields f={f} set={setF} />
        <div className="col-span-full"><button className="btn-primary">Save</button></div>
      </form>
    </Card>
  );
}

function Supplies({ categoryId, items }: { categoryId: string; items: Item[] }) {
  const refresh = useOpsRefresh();
  const [n, setN] = useState({ name: "", unit: "case", sku: "", unitCostCents: null as number | null });
  return (
    <Card eyebrow="Supply list" title="Items staff can pick">
      <div className="divide-y divide-line">
        {items.map((i) => <SupplyRow key={i.id + i.name + i.active} item={i} />)}
      </div>
      <form className="grid items-end gap-3 border-t border-line p-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto]" onSubmit={async (e) => {
        e.preventDefault();
        try { await ops(`/settings/request-types/${categoryId}/items`, { json: n }); setN({ name: "", unit: "case", sku: "", unitCostCents: null }); await refresh(); } catch (err) { toast.error((err as Error).message); }
      }}>
        <label><span className="label mb-1.5 block">New item</span><input required className="input" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} placeholder="Paper towels (multifold)" /></label>
        <label><span className="label mb-1.5 block">Unit</span><input className="input" value={n.unit} onChange={(e) => setN({ ...n, unit: e.target.value })} /></label>
        <label><span className="label mb-1.5 block">SKU</span><input className="input" value={n.sku} onChange={(e) => setN({ ...n, sku: e.target.value })} /></label>
        <label><span className="label mb-1.5 block">Unit cost</span><MoneyInput nullable cents={n.unitCostCents} onChange={(c) => setN({ ...n, unitCostCents: c })} /></label>
        <button className="btn-primary">Add item</button>
      </form>
    </Card>
  );
}

function SupplyRow({ item }: { item: Item }) {
  const refresh = useOpsRefresh();
  const [f, setF] = useState({ ...item, sku: item.sku ?? "" });
  const dirty = JSON.stringify(f) !== JSON.stringify({ ...item, sku: item.sku ?? "" });
  return (
    <form className="grid items-center gap-3 px-4 py-2.5 md:grid-cols-[2fr_1fr_1fr_1fr_80px_auto_auto]" onSubmit={async (e) => {
      e.preventDefault();
      try { await ops(`/settings/supply-items/${item.id}`, { method: "PUT", json: f }); toast.success("Saved"); await refresh(); } catch (err) { toast.error((err as Error).message); }
    }}>
      <input required className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
      <input className="input" placeholder="SKU" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
      <MoneyInput nullable cents={f.unitCostCents} onChange={(c) => setF({ ...f, unitCostCents: c })} />
      <input type="number" className="input" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: parseInt(e.target.value) || 0 })} title="Sort order" />
      <Check label="Active" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
      <button className="btn-outline py-1" disabled={!dirty}>Save</button>
    </form>
  );
}
