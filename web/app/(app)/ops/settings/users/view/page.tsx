"use client";
/** One person: approve a sign-up, or change their role, AVL access, campus and teams. */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { avlLabel, roleLabel, type AvlLevel, type Role } from "@shared/ops/rbac";
import type { Ref, UserRow } from "@shared/ops/types";
import { fmtDateTime, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { AvlSelect, Card, Check, ErrorBox, Field, Loading, PageHeader, Pill, RolePicker } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";

type Data = { user: UserRow; campuses: Ref[]; self: boolean; global: boolean; grantableRoles: Role[]; teams: (Ref & { campusName: string | null; manageable: boolean })[] };
export default function Page() { return <Suspense><EditUser /></Suspense>; }

function EditUser() {
  const id = useSearchParams().get("id") ?? "";
  const d = useOps<Data>(id ? `/settings/users/${id}` : null);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  return <Form key={d.data.user.id + d.data.user.pending} data={d.data} />;
}

function Form({ data }: { data: Data }) {
  const { user: u, self, global } = data;
  const router = useRouter();
  const refresh = useOpsRefresh();
  const [f, setF] = useState({
    name: u.name, email: u.email, title: u.title ?? "", department: u.department ?? "", phone: u.phone ?? "",
    campusId: u.campusId ?? (data.campuses.length === 1 ? data.campuses[0].id : ""), allCampuses: u.allCampuses, role: u.role as Role, avlLevel: u.avlLevel as AvlLevel,
    teamIds: u.teams.filter((t) => !t.synced).map((t) => t.id), active: u.pending ? true : u.active,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const save = async (over: Partial<typeof f> = {}, label = "Saved") => {
    setBusy(label);
    try {
      await ops(`/settings/users/${u.id}`, { method: "PUT", json: { ...f, ...over, campusId: (over.campusId ?? f.campusId) || null } });
      toast.success(label); await refresh();
      if (u.pending) router.push("/ops/settings/users?status=pending");
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(null); }
  };
  return (
    <>
      <PageHeader crumb="Settings / Users" title={u.name} description={<span className="flex items-center gap-2">{u.email}{u.pending && <Pill tone="warn">waiting for approval</Pill>}{!u.registered && <Pill tone="muted">hasn't registered yet</Pill>}</span>} />
      {u.pending && <p className="mb-5 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">{u.name.split(" ")[0]} created a Church Ops account. Choose their campus, role and teams, then approve, or decline the sign-up.</p>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title={self ? "Your profile" : u.pending ? "Approve" : "Profile & access"}>
          <form className="grid gap-4 p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save({}, u.pending ? "Approved" : "Saved"); }}>
            {self && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn md:col-span-2">You can edit your details; another manager changes your own role or campus scope.</p>}
            <Field label="Full name"><input required className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Email" hint={u.registered ? "Their sign-in email" : undefined}><input required type="email" readOnly={u.registered} className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Department"><input className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            {global ? (
              <Field label="Home campus"><select className="input" value={f.campusId} onChange={(e) => setF({ ...f, campusId: e.target.value })}><option value="">—</option>{data.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            ) : <Field label="Campus"><input className="input" readOnly value={u.campusName ?? data.campuses.find((c) => c.id === f.campusId)?.name ?? "Your campus"} /></Field>}
            <div className="md:col-span-2"><span className="label mb-1.5 block">Role</span><RolePicker allowed={data.grantableRoles} value={f.role} onChange={(role) => setF({ ...f, role })} /></div>
            <Field label="AVL access"><AvlSelect value={f.avlLevel} onChange={(avlLevel) => setF({ ...f, avlLevel })} /></Field>
            <div className="space-y-3 pt-5">
              {global && !self && <Check label="Global: all campuses" hint="Managers with this act at every campus. Executives and admins always do." checked={f.allCampuses} onChange={(v) => setF({ ...f, allCampuses: v })} />}
              {!self && !u.pending && <Check label="Active" hint="Inactive people can't use Church Ops." checked={f.active} onChange={(v) => setF({ ...f, active: v })} />}
            </div>
            <div className="md:col-span-2"><span className="label mb-1.5 block">Teams</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.teams.map((t) => {
                  const synced = u.teams.find((x) => x.id === t.id && x.synced);
                  if (synced) return <div key={t.id} className="text-sm text-ink-soft">✓ {t.name} <Pill tone="accent">directory</Pill></div>;
                  if (!t.manageable) return u.teams.some((x) => x.id === t.id) ? <div key={t.id} className="text-sm text-ink-soft">✓ {t.name} <span className="text-[11px] text-ink-faint">other campus</span></div> : null;
                  return <Check key={t.id} label={<>{t.name}{t.campusName ? <span className="text-ink-faint"> · {t.campusName}</span> : null}</>} checked={f.teamIds.includes(t.id)} onChange={(v) => setF({ ...f, teamIds: v ? [...f.teamIds, t.id] : f.teamIds.filter((x) => x !== t.id) })} />;
                })}
                {!data.teams.length && <p className="text-xs text-ink-faint">No teams yet (Settings → Teams).</p>}
              </div>
            </div>
            <div className="col-span-full flex flex-wrap gap-2">
              <button className="btn-primary" disabled={!!busy}>{busy && busy !== "Declined" && <Spinner />}{u.pending ? "Approve" : "Save"}</button>
              {u.pending && <button type="button" className="btn-ghost text-bad" disabled={!!busy} onClick={() => { if (window.confirm(`Decline ${u.name}'s sign-up?`)) void save({ active: false }, "Declined"); }}>Decline</button>}
            </div>
          </form>
        </Card>
        <aside className="space-y-5">
          <Card eyebrow="Effective access">
            <dl className="divide-y divide-line text-sm">
              {[["Role", `${roleLabel(u.effectiveRole)}${u.global ? " · all campuses" : ""}`], ["AVL", u.effectiveAvl === "NONE" ? "None" : avlLabel(u.effectiveAvl)], ["Account", u.registered ? "Registered" : "Not yet"],
                ["Last sign-in", u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"], ["Joined", fmtDateTime(u.createdAt)]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-ink-muted">{k}</dt><dd className="text-right">{v}</dd></div>
              ))}
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}
