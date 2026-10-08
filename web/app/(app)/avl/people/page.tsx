"use client";
/** Who can open Sundays | AVL, and new sign-ups waiting for an AVL Manager. */
import clsx from "clsx";
import { Check as CheckIcon, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AVL_LEVELS, type AvlLevel } from "@shared/ops/rbac";
import type { AvlPerson } from "@shared/ops/types";
import { fmtDate, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Empty, ErrorBox, Loading, MoneyInput, PageHeader, Pill } from "@/components/ops/OpsUi";

type Data = { people: AvlPerson[]; others: { id: string; name: string; email: string }[]; me: string };
const LEVELS = AVL_LEVELS.filter((l) => l.key !== "NONE");

export default function People() {
  const d = useOps<Data>("/avl/people");
  const refresh = useOpsRefresh();
  const [adding, setAdding] = useState(false);
  const set = async (id: string, avlLevel: AvlLevel, active?: boolean, ok = "Saved") => {
    try { await ops(`/avl/people/${id}`, { method: "PUT", json: { avlLevel, active } }); toast.success(ok); await refresh(); } catch (err) { toast.error((err as Error).message); }
  };
  if (!d.data) return <><PageHeader crumb="AVL / Settings" title="People" /><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const pending = d.data.people.filter((p) => p.pending);
  const team = d.data.people.filter((p) => !p.pending);
  return (
    <>
      <PageHeader crumb="AVL / Settings" title="People" description="Who can open Sundays | AVL. Same sign-in as Operations; access to each app is separate."
        actions={d.data.others.length > 0 && <button className="btn-primary" onClick={() => setAdding(!adding)}><Plus size={15} /> Give someone access</button>} />
      <div className="space-y-5">
        {adding && <AddExisting others={d.data.others} onAdd={async (id, lvl) => { await set(id, lvl, undefined, "Access given"); setAdding(false); }} />}
        {pending.length > 0 && (
          <Card eyebrow="Waiting" title={`New sign-ups (${pending.length})`}>
            <ul className="divide-y divide-line">
              {pending.map((p) => <PendingRow key={p.id} p={p} onApprove={(lvl) => set(p.id, lvl, true, `${p.name} can use AVL`)} onDecline={() => set(p.id, "NONE", false, "Declined")} />)}
            </ul>
            <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">Approving here gives AVL only. Someone who should also use Operations is approved by a manager there.</p>
          </Card>
        )}
        <Card eyebrow="Team" title="AVL access">
          {team.length ? (
            <ul className="divide-y divide-line">
              {team.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">{p.name}{p.role === "ADMIN" && <Pill tone="accent">System admin</Pill>}{p.opsAccess && <Pill tone="violet">Operations too</Pill>}{!p.active && <Pill tone="muted">inactive</Pill>}</div>
                    <div className="text-xs text-ink-muted">{p.email}{p.lastLoginAt && ` · last in ${fmtDate(p.lastLoginAt)}`}</div>
                  </div>
                  <HourlyCost p={p} />
                  {p.id === d.data!.me || p.role === "ADMIN" ? (
                    <span className="text-xs text-ink-muted">{p.role === "ADMIN" ? "Everything" : AVL_LEVELS.find((l) => l.key === p.avlLevel)?.label}</span>
                  ) : (
                    <select className="input w-auto py-1.5 text-xs" value={p.avlLevel} onChange={(e) => void set(p.id, e.target.value as AvlLevel, undefined, e.target.value === "NONE" ? "Access removed" : "Saved")}>
                      {AVL_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.key === "NONE" ? "No access" : l.label}</option>)}
                    </select>
                  )}
                </li>
              ))}
            </ul>
          ) : <Empty>Nobody has AVL access yet.</Empty>}
        </Card>
        <Card title="Levels">
          <ul className="divide-y divide-line text-sm">{LEVELS.map((l) => <li key={l.key} className="px-4 py-2.5"><b className="font-medium">{l.label}</b> <span className="text-ink-muted">· {l.help}</span></li>)}</ul>
        </Card>
      </div>
    </>
  );
}

/** What an hour of this person's time costs (for job costing). Saved when you leave the box (MoneyInput commits on blur). */
function HourlyCost({ p }: { p: AvlPerson }) {
  const refresh = useOpsRefresh();
  const [v, setV] = useState<number | null>(p.hourlyCostCents);
  const save = async (c: number | null) => {
    setV(c);
    if (c === p.hourlyCostCents) return;
    try { await ops(`/avl/people/${p.id}`, { method: "PUT", json: { hourlyCostCents: c } }); toast.success(`Hourly cost saved for ${p.name}`); await refresh(); } catch (err) { toast.error((err as Error).message); }
  };
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-muted" title="What an hour of their time costs the business (wages and burden), for job costing">
      <span className="w-28"><MoneyInput nullable cents={v} placeholder="Cost" className="[&_input]:py-1 [&_input]:text-xs" onChange={(c) => void save(c)} /></span>/hr
    </label>
  );
}

function PendingRow({ p, onApprove, onDecline }: { p: AvlPerson; onApprove: (l: AvlLevel) => void; onDecline: () => void }) {
  const [lvl, setLvl] = useState<AvlLevel>("TECH");
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1"><div className="text-sm font-medium">{p.name}</div><div className="text-xs text-ink-muted">{p.email}</div></div>
      <select className="input w-auto py-1.5 text-xs" value={lvl} onChange={(e) => setLvl(e.target.value as AvlLevel)}>{LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select>
      <button className="btn-primary py-1.5 text-xs" onClick={() => onApprove(lvl)}><CheckIcon size={13} /> Approve</button>
      <button className="btn-ghost py-1.5 text-xs text-bad" onClick={onDecline}><X size={13} /> Decline</button>
    </li>
  );
}

function AddExisting({ others, onAdd }: { others: Data["others"]; onAdd: (id: string, l: AvlLevel) => Promise<void> }) {
  const [id, setId] = useState(others[0]?.id ?? "");
  const [lvl, setLvl] = useState<AvlLevel>("TECH");
  return (
    <Card eyebrow="Add" title="Give someone from Operations AVL access">
      <form className={clsx("flex flex-wrap items-end gap-3 p-4")} onSubmit={(e) => { e.preventDefault(); void onAdd(id, lvl); }}>
        <label className="min-w-[240px] flex-1"><span className="label mb-1.5 block">Person</span>
          <select className="input" value={id} onChange={(e) => setId(e.target.value)}>{others.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.email}</option>)}</select></label>
        <label><span className="label mb-1.5 block">Level</span>
          <select className="input" value={lvl} onChange={(e) => setLvl(e.target.value as AvlLevel)}>{LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
        <button className="btn-primary">Give access</button>
      </form>
      <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">Someone new? Have them create an account on the sign-in screen; they&apos;ll show up here to approve.</p>
    </Card>
  );
}
