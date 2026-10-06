"use client";
/**
 * Plans, add-on modules and platform settings. Whatever's here is what the pricing page and
 * "start your organization" show, straight away.
 */
import clsx from "clsx";
import { ExternalLink, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmtPrice, MODULE_KEYS, type ModuleDef, type ModuleKey, type PlanDef } from "@shared/ops/billing";
import { ops, STANDALONE, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Check, ErrorBox, Field, Loading, MoneyInput, PageHeader, PercentInput, Pill } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";

type Plan = PlanDef & { orgs: number };
type Data = { plans: Plan[]; modules: ModuleDef[]; settings: { churchDiscountBps: number; trialDays: number; defaultPlanId: string | null } };

const blankPlan = (n: number): PlanDef => ({
  id: "", name: "", tagline: "", priceMonthlyCents: 0, priceYearlyCents: 0, modules: ["technology"], maxUsers: null, maxCampuses: null,
  trialDays: 14, public: true, active: true, highlight: false, sortOrder: n,
});

export default function Plans() {
  const d = useOps<Data>("/platform/catalog");
  const [adding, setAdding] = useState(false);
  if (!d.data) return <><PageHeader crumb="Sundays admin" title="Plans & modules" /><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const { plans, modules, settings } = d.data;
  return (
    <>
      <PageHeader crumb="Sundays admin" title="Plans & modules" description="Changes show on the pricing page and when someone starts an organization, right away."
        actions={<>
          {STANDALONE && <a className="btn-outline" href="/pricing" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Pricing page</a>}
          <button className="btn-primary" onClick={() => setAdding(true)} disabled={adding}><Plus size={15} /> New plan</button>
        </>} />
      <div className="space-y-5">
        <Settings key={JSON.stringify(settings)} settings={settings} plans={plans} />
        {adding && <PlanEditor plan={blankPlan(plans.length)} modules={modules} onDone={() => setAdding(false)} />}
        <div className="grid gap-5 lg:grid-cols-2">
          {plans.map((p) => <PlanEditor key={JSON.stringify(p)} plan={p} orgs={p.orgs} modules={modules} isDefault={settings.defaultPlanId === p.id} />)}
        </div>
        <Card eyebrow="Add-ons" title="Modules" action={<span className="text-xs text-ink-muted">Add-on price = what an org pays for a module its plan doesn&apos;t include</span>}>
          <div className="divide-y divide-line">{modules.map((m) => <ModuleRow key={JSON.stringify(m)} m={m} />)}</div>
        </Card>
      </div>
    </>
  );
}

function Settings({ settings, plans }: { settings: Data["settings"]; plans: Plan[] }) {
  const refresh = useOpsRefresh();
  const [s, setS] = useState(settings);
  return (
    <Card eyebrow="Everyone" title="Platform settings">
      <form className="grid items-end gap-4 p-4 sm:grid-cols-4" onSubmit={async (e) => {
        e.preventDefault();
        try { await ops("/platform/settings", { method: "PUT", json: s }); toast.success("Saved"); await refresh(); } catch (err) { toast.error((err as Error).message); }
      }}>
        <Field label="Church discount" hint="Off every church's bill"><PercentInput bps={s.churchDiscountBps} onChange={(churchDiscountBps) => setS({ ...s, churchDiscountBps })} /></Field>
        <Field label="Default trial (days)"><input type="number" min={0} className="input" value={s.trialDays} onChange={(e) => setS({ ...s, trialDays: parseInt(e.target.value) || 0 })} /></Field>
        <Field label="Default plan"><select className="input" value={s.defaultPlanId ?? ""} onChange={(e) => setS({ ...s, defaultPlanId: e.target.value || null })}>
          <option value="">First plan</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <div><button className="btn-primary">Save</button></div>
      </form>
    </Card>
  );
}

function PlanEditor({ plan, modules, orgs, isDefault, onDone }: { plan: PlanDef; modules: ModuleDef[]; orgs?: number; isDefault?: boolean; onDone?: () => void }) {
  const refresh = useOpsRefresh();
  const [p, setP] = useState(plan);
  const [busy, setBusy] = useState(false);
  const isNew = !plan.id;
  const set = (x: Partial<PlanDef>) => setP({ ...p, ...x });
  const toggle = (k: ModuleKey, on: boolean) => set({ modules: MODULE_KEYS.filter((m) => (m === k ? on : p.modules.includes(m))) });
  return (
    <Card className={clsx(!p.active && "opacity-70")} eyebrow={isNew ? "New plan" : `${orgs ?? 0} organization${orgs === 1 ? "" : "s"}`}
      title={<span className="flex items-center gap-2">{p.name || "Untitled plan"}{isDefault && <Pill tone="accent">default</Pill>}{!p.public && <Pill tone="muted">private</Pill>}{!p.active && <Pill tone="muted">inactive</Pill>}</span>}>
      <form className="space-y-4 p-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        const { id, ...body } = p;
        try {
          if (isNew) await ops("/platform/plans", { json: body }); else await ops(`/platform/plans/${id}`, { method: "PUT", json: body });
          toast.success(isNew ? "Plan created" : "Plan saved"); await refresh(); onDone?.();
        } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input required className="input" value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="One-line description"><input className="input" value={p.tagline ?? ""} onChange={(e) => set({ tagline: e.target.value })} /></Field>
          <Field label="Monthly price"><MoneyInput cents={p.priceMonthlyCents} onChange={(c) => set({ priceMonthlyCents: c ?? 0 })} /></Field>
          <Field label="Yearly price" hint={p.priceMonthlyCents ? `${fmtPrice(p.priceMonthlyCents * 12)} if paid monthly` : undefined}><MoneyInput cents={p.priceYearlyCents} onChange={(c) => set({ priceYearlyCents: c ?? 0 })} /></Field>
        </div>
        <div>
          <span className="label mb-1.5 block">Includes</span>
          <div className="grid gap-2 sm:grid-cols-2">{modules.map((m) => <Check key={m.key} label={m.name} checked={p.modules.includes(m.key)} onChange={(v) => toggle(m.key, v)} />)}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Free trial (days)"><input type="number" min={0} className="input" value={p.trialDays} onChange={(e) => set({ trialDays: parseInt(e.target.value) || 0 })} /></Field>
          <Field label="Max people" hint="Blank = unlimited"><input type="number" min={1} className="input" value={p.maxUsers ?? ""} onChange={(e) => set({ maxUsers: e.target.value ? parseInt(e.target.value) : null })} /></Field>
          <Field label="Order"><input type="number" className="input" value={p.sortOrder} onChange={(e) => set({ sortOrder: parseInt(e.target.value) || 0 })} /></Field>
        </div>
        <div className="flex flex-wrap gap-5">
          <Check label="On the pricing page" hint="Off = only you can assign it" checked={p.public} onChange={(v) => set({ public: v })} />
          <Check label="Highlight as popular" checked={p.highlight} onChange={(v) => set({ highlight: v })} />
          <Check label="Active" hint="Off = no new sign-ups on it" checked={p.active} onChange={(v) => set({ active: v })} />
        </div>
        <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{busy && <Spinner />}{isNew ? "Create plan" : "Save plan"}</button>{onDone && <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>}</div>
      </form>
    </Card>
  );
}

function ModuleRow({ m }: { m: ModuleDef }) {
  const refresh = useOpsRefresh();
  const [f, setF] = useState(m);
  return (
    <form className="grid items-end gap-3 px-4 py-3 sm:grid-cols-[1.2fr_2fr_1fr_1fr_auto_auto]" onSubmit={async (e) => {
      e.preventDefault();
      try { await ops(`/platform/modules/${m.key}`, { method: "PUT", json: f }); toast.success(`${f.name} saved`); await refresh(); } catch (err) { toast.error((err as Error).message); }
    }}>
      <Field label="Module"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Description"><input className="input" value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Add-on / month"><MoneyInput cents={f.priceMonthlyCents} onChange={(c) => setF({ ...f, priceMonthlyCents: c ?? 0 })} /></Field>
      <Field label="Add-on / year"><MoneyInput cents={f.priceYearlyCents} onChange={(c) => setF({ ...f, priceYearlyCents: c ?? 0 })} /></Field>
      <div className="pb-2"><Check label="Offered" checked={f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
      <button className="btn-outline">Save</button>
    </form>
  );
}
