"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import type { Ref } from "@shared/ops/types";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Check, Empty, ErrorBox, Field, Loading, PageHeader, Pill } from "@/components/ops/OpsUi";

type Team = { id: string; name: string; description: string | null; campusId: string | null; email: string | null; active: boolean };
type Data = { team: Team; members: { id: string; name: string; email: string; isLead: boolean; synced: boolean }[]; routing: { id: string; category: string; icon: string | null; campus: string | null; handles: boolean }[]; campuses: Ref[]; users: Ref[]; global: boolean };
export default function Page() { return <Suspense><TeamView /></Suspense>; }

function TeamView() {
  const id = useSearchParams().get("id") ?? "";
  const d = useOps<Data>(id ? `/settings/teams/${id}` : null);
  const refresh = useOpsRefresh();
  const [add, setAdd] = useState({ userId: "", isLead: false });
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const { team, members, routing, users } = d.data;
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await refresh(); } catch (e) { toast.error((e as Error).message); } };
  return (
    <>
      <PageHeader crumb="Settings / Teams" title={team.name} description={team.description ?? undefined} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card title={`${members.length} member${members.length === 1 ? "" : "s"}`} eyebrow="Members">
            {members.length ? (
              <ul className="divide-y divide-line">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1"><div className="font-medium">{m.name} {m.isLead && <Pill tone="accent">lead</Pill>}</div><div className="text-[11px] text-ink-faint">{m.email}</div></div>
                    <button className="btn-ghost py-1 text-xs" onClick={() => act(() => ops(`/settings/teams/${team.id}/members`, { json: { userId: m.id, isLead: !m.isLead } }))}>{m.isLead ? "Remove lead" : "Make lead"}</button>
                    <button className="btn-ghost py-1 text-xs text-bad" onClick={() => window.confirm(`Remove ${m.name} from ${team.name}?`) && act(() => ops(`/settings/teams/${team.id}/members/${m.id}`, { method: "DELETE" }))}>Remove</button>
                  </li>
                ))}
              </ul>
            ) : <Empty>No members yet.</Empty>}
            <form className="flex flex-wrap items-end gap-3 border-t border-line p-4" onSubmit={(e) => { e.preventDefault(); if (add.userId) void act(async () => { await ops(`/settings/teams/${team.id}/members`, { json: add }); setAdd({ userId: "", isLead: false }); }); }}>
              <select className="input max-w-xs" value={add.userId} onChange={(e) => setAdd({ ...add, userId: e.target.value })}>
                <option value="">Add someone…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <Check label="Team lead" checked={add.isLead} onChange={(v) => setAdd({ ...add, isLead: v })} />
              <button className="btn-primary" disabled={!add.userId}>Add member</button>
            </form>
          </Card>
          <Card eyebrow="Routing" title="Request types">
            {routing.length ? (
              <ul className="divide-y divide-line text-sm">
                {routing.map((r) => <li key={r.id + r.handles} className="px-4 py-2.5">{r.handles ? "Handles" : "Approves"} <b>{r.icon} {r.category}</b> <span className="text-ink-muted">· {r.campus ?? "all other campuses"}</span></li>)}
              </ul>
            ) : <Empty>Not routed to any request type yet.</Empty>}
          </Card>
        </div>
        <TeamDetails data={d.data} />
      </div>
    </>
  );
}

function TeamDetails({ data }: { data: Data }) {
  const refresh = useOpsRefresh();
  const t = data.team;
  const [f, setF] = useState({ name: t.name, campusId: t.campusId ?? "", email: t.email ?? "", description: t.description ?? "", active: t.active });
  return (
    <Card eyebrow="Settings" title="Team details">
      <form className="grid gap-4 p-4" onSubmit={async (e) => {
        e.preventDefault();
        try { await ops(`/settings/teams/${t.id}`, { method: "PUT", json: { ...f, campusId: f.campusId || null } }); toast.success("Saved"); await refresh(); } catch (err) { toast.error((err as Error).message); }
      }}>
        <Field label="Name"><input required className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Campus">{data.global ? <select className="input" value={f.campusId} onChange={(e) => setF({ ...f, campusId: e.target.value })}><option value="">All campuses</option>{data.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          : <input className="input" readOnly value={data.campuses.find((c) => c.id === t.campusId)?.name ?? "All campuses"} />}</Field>
        <Field label="Shared inbox"><input type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Description"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Check label="Active" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
        <div><button className="btn-primary">Save</button></div>
      </form>
    </Card>
  );
}
