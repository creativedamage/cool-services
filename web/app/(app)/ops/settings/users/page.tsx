"use client";
import { useOpsUser } from "@/components/ops/context";
import { WEBSITE_URL } from "@shared/cloud";
import { useModule } from "@/components/ops/context";
/** People: waiting for approval, active, inactive. Managers add, approve and edit within their campus. */
import clsx from "clsx";
import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { avlLabel, roleLabel, type AvlLevel, type Role } from "@shared/ops/rbac";
import { checkinLabel, type CheckinLevel } from "@shared/ops/checkin";
import { CHECKIN_URL } from "@shared/cloud";
import type { Ref, UserRow } from "@shared/ops/types";
import { fmtDate, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { STANDALONE } from "@/lib/ops";
import { AvlSelect, CheckinSelect, Card, Check, Empty, ErrorBox, Field, Loading, PageHeader, Pill, RolePicker, Table, Tabs } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";

type Data = { users: UserRow[]; campuses: Ref[]; teams: Ref[]; pending: number; global: boolean; grantableRoles: Role[]; myCampusId: string | null; grantsAvl: boolean };
export default function Page() { return <Suspense><Users /></Suspense>; }

function Users() {
  const multi = useModule("campuses");
  const sp = useSearchParams();
  const router = useRouter();
  const status = sp.get("status") ?? "active";
  const [q, setQ] = useState("");
  const [campus, setCampus] = useState("");
  const [role, setRole] = useState("");
  const params = new URLSearchParams({ status, ...(sp.get("q") ? { q: sp.get("q")! } : {}), ...(campus ? { campus } : {}), ...(role ? { role } : {}) });
  const d = useOps<Data>(`/settings/users?${params}`);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader crumb="Settings" title="Users" description={d.data?.global ? "Everyone across all campuses." : "People at your campus, and new sign-ups waiting for a campus."}
        actions={<button className="btn-primary" onClick={() => setAdding(!adding)}><UserPlus size={15} /> Invite someone</button>} />
      {adding && d.data && <AddUser data={d.data} onDone={() => setAdding(false)} />}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={status} onChange={(s) => router.replace(`/ops/settings/users?status=${s}`)} items={[
          { key: "pending", label: "Waiting for approval", count: d.data?.pending ?? null }, { key: "active", label: "Active" }, { key: "inactive", label: "Inactive" },
          ...(d.data?.global ? [{ key: "avl", label: "Other apps only" }] : []),
        ]} />
        <form className="ml-auto flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); router.replace(`/ops/settings/users?${new URLSearchParams({ status, ...(q ? { q } : {}) })}`); }}>
          <input className="input w-60" placeholder="Search name, email, department…" value={q} onChange={(e) => setQ(e.target.value)} />
          {d.data?.global && multi && (
            <select className="input w-40" value={campus} onChange={(e) => setCampus(e.target.value)}>
              <option value="">All campuses</option><option value="ALL">Global users</option>{d.data.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <select className="input w-36" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Any role</option><option value="STAFF">Staff</option><option value="MANAGER">Manager</option><option value="EXECUTIVE">Executive</option><option value="ADMIN">System admin</option>
          </select>
        </form>
      </div>
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <Card>
          {d.data.users.length ? (
            <Table min={900} head={<tr><th>User</th><th>Role</th><th>AVL</th><th>Check-ins</th>{multi && <th>Campus</th>}<th>Teams</th><th>Last sign-in</th><th /></tr>}>
              {d.data.users.map((u) => (
                <tr key={u.id}>
                  <td><div className="font-medium">{u.name}</div><div className="text-[11px] text-ink-faint">{u.email}{u.title && ` · ${u.title}`}</div></td>
                  <td>{u.pending ? <Pill tone="warn">waiting</Pill> : <Pill tone={u.effectiveRole === "STAFF" ? "muted" : u.effectiveRole === "MANAGER" ? "info" : u.effectiveRole === "EXECUTIVE" ? "accent" : "violet"}>{roleLabel(u.effectiveRole)}{u.effectiveRole === "MANAGER" && u.global ? " · global" : ""}</Pill>}</td>
                  <td className="text-xs text-ink-soft">{u.effectiveAvl === "NONE" ? "—" : avlLabel(u.effectiveAvl)}</td>
                  <td className="text-xs text-ink-soft">{(u.effectiveCheckin ?? "NONE") === "NONE" ? "—" : checkinLabel(u.effectiveCheckin)}</td>
                  {multi && <td className="text-ink-soft">{u.global ? "All campuses" : u.campusName ?? "—"}</td>}
                  <td className="text-xs text-ink-soft">{u.teams.map((t) => t.name).join(", ") || "—"}</td>
                  <td className="text-xs text-ink-faint">{u.registered ? (u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never") : "Hasn't registered yet"}</td>
                  <td className="text-right">{u.editable ? <Link href={`/ops/settings/users/view?id=${u.id}`} className={clsx(u.pending ? "btn-primary py-1" : "text-xs text-accent hover:underline")}>{u.pending ? "Review" : "Edit →"}</Link> : <span className="text-[11px] text-ink-faint">view only</span>}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>{status === "pending" ? "Nobody is waiting. New sign-ups show up here." : status === "avl" ? "Nobody uses only AVL or check-ins." : "No users match."}</Empty>}
        </Card>
      )}
    </>
  );
}

function AddUser({ data, onDone }: { data: Data; onDone: () => void }) {
  const multi = useModule("campuses");
  const router = useRouter();
  const refresh = useOpsRefresh();
  const me = useOpsUser();
  const [f, setF] = useState({ name: "", email: "", title: "", department: "", campusId: data.myCampusId ?? data.campuses[0]?.id ?? "", allCampuses: false, role: "STAFF" as Role, avlLevel: "NONE" as AvlLevel, opsAccess: true, checkinLevel: "NONE" as CheckinLevel, teamIds: [] as string[] });
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Invite someone" eyebrow="They're approved already: when they create their Sundays account with this email, they're straight in." className="mb-5">
      <form className="grid gap-4 p-4 md:grid-cols-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try {
          const r = await ops<{ id: string }>("/settings/users", { json: { ...f, campusId: f.campusId || null } });
          // A ready-to-send invitation (Sundays doesn't email it for you yet).
          const site = typeof window !== "undefined" && STANDALONE ? window.location.origin : WEBSITE_URL;
          // Check-ins only: no Sundays account needed, they sign in with Planning Center.
          const text = !f.opsAccess && f.avlLevel === "NONE" && f.checkinLevel !== "NONE"
            ? `${me.org.name ?? "We"} added you to team check-ins. On your phone, open ${CHECKIN_URL} and sign in with Planning Center (your Planning Center profile needs ${f.email.trim()}). Share → Add to Home Screen keeps it handy.`
            : `${me.org.name ?? "We"} added you to Sundays. Create your account at ${site} using ${f.email.trim()} and you'll be straight in.`;
          const copied = await navigator.clipboard?.writeText(text).then(() => true, () => false);
          toast.success(copied ? "Added. An invitation is on your clipboard: paste it into an email or text." : `Added. Tell them to create an account at ${site} with ${f.email.trim()}.`, { duration: 8000 });
          await refresh(); onDone(); router.push(`/ops/settings/users/view?id=${r.id}`);
        } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
      }}>
        <Field label="Full name"><input required className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><input required type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        {!multi ? null : data.global ? (
          <>
            <Field label="Home campus"><select className="input" value={f.campusId} onChange={(e) => setF({ ...f, campusId: e.target.value })}><option value="">—</option>{data.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <div className="flex items-end pb-2"><Check label="Global: all campuses" hint="Managers with this can act at every campus." checked={f.allCampuses} onChange={(v) => setF({ ...f, allCampuses: v })} /></div>
          </>
        ) : <Field label="Campus"><input className="input" readOnly value={data.campuses.find((c) => c.id === data.myCampusId)?.name ?? ""} /></Field>}
        {data.grantsAvl && <Field label="AVL access" hint="Separate app; only AVL Managers set this."><AvlSelect value={f.avlLevel} onChange={(avlLevel) => setF({ ...f, avlLevel })} /></Field>}
        <Field label="Team check-ins" hint="On phones, signed in with Planning Center using this email."><CheckinSelect value={f.checkinLevel} onChange={(checkinLevel) => setF({ ...f, checkinLevel })} /></Field>
        <div className="flex items-end pb-2"><Check label="Sundays | Operations" hint="Off for someone who only does check-ins." checked={f.opsAccess} onChange={(opsAccess) => setF({ ...f, opsAccess })} /></div>
        <div className="md:col-span-2"><span className="label mb-1.5 block">Role</span><RolePicker allowed={data.grantableRoles} value={f.role} onChange={(role) => setF({ ...f, role })} /></div>
        <div><span className="label mb-1.5 block">Teams</span>
          <div className="max-h-44 space-y-2 overflow-y-auto">{data.teams.map((t) => <Check key={t.id} label={t.name} checked={f.teamIds.includes(t.id)} onChange={(v) => setF({ ...f, teamIds: v ? [...f.teamIds, t.id] : f.teamIds.filter((x) => x !== t.id) })} />)}
            {!data.teams.length && <p className="text-xs text-ink-faint">No teams yet.</p>}</div>
        </div>
        <div className="col-span-full flex gap-2"><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Create user</button><button type="button" className="btn-ghost" onClick={onDone}>Cancel</button></div>
      </form>
    </Card>
  );
}
