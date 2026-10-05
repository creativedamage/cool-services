"use client";
/** Campuses: people, teams, requests and quotes are tied to one. */
import { useState } from "react";
import { toast } from "sonner";
import type { CampusRow } from "@shared/ops/types";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Check, ErrorBox, Field, Loading, PageHeader } from "@/components/ops/OpsUi";

type F = { name: string; code: string; addressLine1: string; city: string; state: string; postalCode: string; phone: string; sortOrder: number; active: boolean };
const blank: F = { name: "", code: "", addressLine1: "", city: "", state: "", postalCode: "", phone: "", sortOrder: 0, active: true };

export default function Campuses() {
  const d = useOps<{ campuses: CampusRow[]; global: boolean }>("/settings/campuses");
  return (
    <>
      <PageHeader crumb="Settings" title="Campuses" description={d.data?.global ? "Every person, team, request and quote can be tied to a campus. Add campuses here as the church grows." : "Details for your campus."} />
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <div className="space-y-5">
          {d.data.campuses.map((c) => (
            <Card key={c.id + c.name} eyebrow={c.code} title={c.name} action={<span className="text-xs text-ink-faint">{c.users} people · {c.teams} teams · {c.requests} requests{!c.active && " · inactive"}</span>}>
              <CampusForm init={{ ...blank, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ""])), sortOrder: c.sortOrder, active: c.active } as F} id={c.id} global={d.data!.global} />
            </Card>
          ))}
          {d.data.global && <Card eyebrow="New" title="Add campus"><CampusForm init={blank} global /></Card>}
          <p className="text-xs text-ink-faint">After adding a campus, choose who handles each request type there (Request types) and add its teams (Teams).</p>
        </div>
      )}
    </>
  );
}

function CampusForm({ init, id, global }: { init: F; id?: string; global: boolean }) {
  const refresh = useOpsRefresh();
  const [f, setF] = useState(init);
  const t = (k: keyof F, label: string, cls?: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <Field label={label} className={cls}><input className="input" value={String(f[k] ?? "")} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></Field>
  );
  return (
    <form className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await ops(id ? `/settings/campuses/${id}` : "/settings/campuses", { method: id ? "PUT" : "POST", json: f });
        toast.success(id ? "Saved" : "Campus added"); if (!id) setF(blank); await refresh();
      } catch (err) { toast.error((err as Error).message); }
    }}>
      {t("name", "Name", undefined, { required: true, placeholder: "Main campus" })}
      {t("code", "Code", undefined, { required: true, maxLength: 10, placeholder: "MAIN", readOnly: Boolean(id) && !global, className: "input font-mono uppercase" })}
      {t("addressLine1", "Address", "lg:col-span-2")}
      {t("city", "City")}{t("state", "State")}{t("postalCode", "ZIP")}{t("phone", "Phone")}
      <Field label="Sort order"><input type="number" className="input" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: parseInt(e.target.value) || 0 })} /></Field>
      <div className="flex items-end pb-2"><Check label="Active" checked={f.active} disabled={!global} onChange={(v) => setF({ ...f, active: v })} /></div>
      <div className="col-span-full"><button className="btn-primary">{id ? "Save" : "Add campus"}</button></div>
    </form>
  );
}
