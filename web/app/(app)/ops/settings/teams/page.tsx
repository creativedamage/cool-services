"use client";
import { useModule } from "@/components/ops/context";
/** Teams handle and approve requests; route each request type to a team per campus. */
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { Ref, TeamRow } from "@shared/ops/types";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Empty, ErrorBox, Field, Loading, PageHeader, Pill, Table } from "@/components/ops/OpsUi";

export default function Teams() {
  const multi = useModule("campuses");
  const d = useOps<{ teams: TeamRow[]; campuses: Ref[]; global: boolean; myCampusId: string | null }>("/settings/teams");
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader crumb="Settings" title="Teams" description="Teams handle and approve requests. Route each request type to a team per campus under Request types."
        actions={<button className="btn-primary" onClick={() => setAdding(!adding)}><Plus size={15} /> New team</button>} />
      {adding && d.data && <NewTeam campuses={d.data.campuses} global={d.data.global} myCampusId={d.data.myCampusId} />}
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <Card>
          {d.data.teams.length ? (
            <Table min={700} head={<tr><th>Team</th>{multi && <th>Campus</th>}<th className="text-right">Members</th><th className="text-right">Handles</th><th className="text-right">Approves</th><th /></tr>}>
              {d.data.teams.map((t) => (
                <tr key={t.id}>
                  <td><div className="font-medium">{t.name}{!t.active && <Pill tone="muted">inactive</Pill>}</div><div className="text-[11px] text-ink-faint">{t.description}</div></td>
                  {multi && <td className="text-ink-soft">{t.campusName ?? "All campuses"}</td>}
                  <td className="text-right font-mono">{t.members}</td><td className="text-right font-mono text-ink-soft">{t.handles}</td><td className="text-right font-mono text-ink-soft">{t.approves}</td>
                  <td className="text-right">{t.manageable ? <Link href={`/ops/settings/teams/view?id=${t.id}`} className="text-xs text-accent hover:underline">Manage →</Link> : <span className="text-[11px] text-ink-faint">all-campus team</span>}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No teams yet. Create one (e.g. “Facilities”, “IT”, “Leadership”).</Empty>}
        </Card>
      )}
    </>
  );
}

function NewTeam({ campuses, global, myCampusId }: { campuses: Ref[]; global: boolean; myCampusId: string | null }) {
  const multi = useModule("campuses");
  const router = useRouter();
  const refresh = useOpsRefresh();
  const [f, setF] = useState({ name: "", campusId: global ? "" : myCampusId ?? "", email: "", description: "" });
  return (
    <Card title="New team" className="mb-5">
      <form className="grid gap-4 p-4 md:grid-cols-4" onSubmit={async (e) => {
        e.preventDefault();
        try { const r = await ops<{ id: string }>("/settings/teams", { json: { ...f, campusId: f.campusId || null } }); await refresh(); router.push(`/ops/settings/teams/view?id=${r.id}`); }
        catch (err) { toast.error((err as Error).message); }
      }}>
        <Field label="Name"><input required className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Facilities" /></Field>
        {multi && <Field label="Campus">{global ? <select className="input" value={f.campusId} onChange={(e) => setF({ ...f, campusId: e.target.value })}><option value="">All campuses</option>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          : <input className="input" readOnly value={campuses.find((c) => c.id === myCampusId)?.name ?? ""} />}</Field>}
        <Field label="Shared inbox (optional)"><input type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Description"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="col-span-full"><button className="btn-primary">Create team</button></div>
      </form>
    </Card>
  );
}
