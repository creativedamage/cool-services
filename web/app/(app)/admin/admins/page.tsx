"use client";
/** Sundays super admins: run every organization, plans and billing. */
import { Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { PlatformAdminRow } from "@shared/ops/types";
import { fmtDate, ops, useOps, useOpsMe, useOpsRefresh, useOpsSession } from "@/lib/ops";
import { Card, ErrorBox, Loading, PageHeader, Pill } from "@/components/ops/OpsUi";

export default function Admins() {
  const d = useOps<PlatformAdminRow[]>("/platform/admins");
  const { session } = useOpsSession();
  const me = useOpsMe(Boolean(session)).data;
  const refresh = useOpsRefresh();
  const [email, setEmail] = useState("");
  return (
    <>
      <PageHeader crumb="Sundays admin" title="Super admins" description="They can open any organization as its admin, manage plans and billing, and add other super admins." />
      <div className="space-y-5">
        <Card eyebrow="Add" title="Make someone a super admin">
          <form className="flex flex-wrap items-end gap-3 p-4" onSubmit={async (e) => {
            e.preventDefault();
            try { await ops("/platform/admins", { json: { email } }); toast.success(`${email} is a super admin`); setEmail(""); await refresh(); } catch (err) { toast.error((err as Error).message); }
          }}>
            <label className="min-w-[260px] flex-1"><span className="label mb-1.5 block">Email</span><input required type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></label>
            <button className="btn-primary"><UserPlus size={15} /> Add</button>
            <p className="basis-full text-[11px] text-ink-faint">If they don&apos;t have a Sundays account yet, it applies when they create one with this email.</p>
          </form>
        </Card>
        <ErrorBox error={d.error} />
        {!d.data ? (!d.error && <Loading />) : (
          <Card>
            <ul className="divide-y divide-line">
              {d.data.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1"><span className="font-medium">{a.email}</span>{me?.email === a.email && <span className="ml-2"><Pill tone="accent">you</Pill></span>}{!a.authId && <span className="ml-2"><Pill tone="muted">no account yet</Pill></span>}
                    <span className="block text-xs text-ink-muted">Added {fmtDate(a.createdAt)}{a.addedBy ? ` by ${a.addedBy}` : ""}</span></span>
                  {me?.email !== a.email && (
                    <button className="btn-ghost text-bad" onClick={async () => {
                      if (!confirm(`Remove ${a.email} as a super admin?`)) return;
                      try { await ops(`/platform/admins/${a.id}`, { method: "DELETE" }); await refresh(); } catch (err) { toast.error((err as Error).message); }
                    }}><Trash2 size={14} /> Remove</button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
