"use client";
/**
 * Plan cards and "start your organization", built from whatever plans the super admins have set up
 * (GET /public/pricing), so a new or changed plan shows here straight away.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { fmtPrice, ORG_TYPES, type Interval, type OrgType, type PlanDef } from "@shared/ops/billing";
import type { PublicPricing } from "@shared/ops/types";
import { ops, publicPricing, rememberOrg } from "@/lib/ops";
import { Spinner } from "@/components/ui";

export const usePricing = () => useQuery({ queryKey: ["public-pricing"], queryFn: () => publicPricing<PublicPricing>(), staleTime: 60_000 });

const ALWAYS = ["Requests, approvals and a work queue", "People, teams and access levels", "Activity history"];

/** Price shown for a plan (after the church discount when it applies). */
function shown(plan: PlanDef, interval: Interval, churchBps: number, church: boolean) {
  const base = interval === "YEARLY" ? plan.priceYearlyCents : plan.priceMonthlyCents;
  return church ? Math.round(base * (1 - churchBps / 10_000)) : base;
}

export function PlanCards({ pricing, interval, church, selected, onSelect, compact }: {
  pricing: PublicPricing; interval: Interval; church: boolean; selected?: string | null; onSelect?: (id: string) => void; compact?: boolean;
}) {
  const name = (k: string) => pricing.modules.find((m) => m.key === k)?.name ?? k;
  return (
    <div className={clsx("grid gap-3", pricing.plans.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
      {pricing.plans.map((p) => {
        const price = shown(p, interval, pricing.churchDiscountBps, church);
        const base = interval === "YEARLY" ? p.priceYearlyCents : p.priceMonthlyCents;
        const on = selected === p.id;
        const Tag = onSelect ? "button" : "div";
        return (
          <Tag key={p.id} type={onSelect ? "button" : undefined} onClick={onSelect ? () => onSelect(p.id) : undefined}
            className={clsx("relative flex flex-col rounded-xl border p-4 text-left transition",
              on ? "border-accent bg-accent-soft ring-1 ring-accent/50" : p.highlight ? "border-accent/50" : "border-line",
              onSelect && !on && "hover:border-line-strong")}>
            {p.highlight && <span className="absolute -top-2.5 right-3 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-on-accent"><Sparkles size={10} /> Popular</span>}
            <div className="text-[15px] font-semibold">{p.name}</div>
            {p.tagline && <div className="mt-0.5 text-xs text-ink-muted">{p.tagline}</div>}
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tabular-nums">{base === 0 ? "Free" : fmtPrice(price)}</span>
              {base > 0 && <span className="text-xs text-ink-muted">/ {interval === "YEARLY" ? "year" : "month"}</span>}
            </div>
            {church && base > 0 && pricing.churchDiscountBps > 0 && (
              <div className="text-[11px] text-ok">Church price · <span className="line-through opacity-70">{fmtPrice(base)}</span> {pricing.churchDiscountBps / 100}% off</div>
            )}
            {p.trialDays > 0 && <div className="mt-1 text-[11px] text-ink-faint">{p.trialDays}-day free trial</div>}
            {!compact && (
              <ul className="mt-3 space-y-1.5 text-xs text-ink-soft">
                {[...ALWAYS, ...p.modules.map(name)].map((t) => <li key={t} className="flex gap-1.5"><Check size={13} className="mt-0.5 shrink-0 text-accent" />{t}</li>)}
                {p.maxUsers && <li className="flex gap-1.5 text-ink-muted"><Check size={13} className="mt-0.5 shrink-0 opacity-0" />Up to {p.maxUsers} people</li>}
              </ul>
            )}
          </Tag>
        );
      })}
    </div>
  );
}

export function IntervalToggle({ value, onChange }: { value: Interval; onChange: (v: Interval) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line p-0.5 text-xs">
      {(["MONTHLY", "YEARLY"] as Interval[]).map((k) => (
        <button key={k} type="button" onClick={() => onChange(k)} className={clsx("rounded-md px-3 py-1.5 font-medium", value === k ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-hover")}>
          {k === "MONTHLY" ? "Monthly" : "Yearly"}
        </button>
      ))}
    </div>
  );
}

/** Start an organization: name, type, plan. The person becomes its System admin. */
export function CreateOrgForm({ onCreated, onCancel }: { onCreated?: (id: string) => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const pricing = usePricing();
  const [f, setF] = useState<{ name: string; orgType: OrgType; planId: string | null; interval: Interval }>({ name: "", orgType: "CHURCH", planId: null, interval: "MONTHLY" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planId = f.planId ?? pricing.data?.plans.find((p) => p.highlight)?.id ?? pricing.data?.plans[0]?.id ?? null;
  return (
    <form className="space-y-5" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      try {
        const r = await ops<{ id: string }>("/orgs", { json: { ...f, planId } });
        rememberOrg(r.id);
        qc.removeQueries({ queryKey: ["ops"] });
        await qc.invalidateQueries({ queryKey: ["ops"] });
        onCreated?.(r.id);
      } catch (err) { setError((err as Error).message); setBusy(false); }
    }}>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <label className="block"><span className="label mb-1.5 block">Organization name</span>
          <input required autoFocus minLength={2} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Grace Fellowship" /></label>
        <label className="block"><span className="label mb-1.5 block">Type</span>
          <select className="input" value={f.orgType} onChange={(e) => setF({ ...f, orgType: e.target.value as OrgType })}>
            {ORG_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select></label>
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="label">Plan</span>
          <IntervalToggle value={f.interval} onChange={(interval) => setF({ ...f, interval })} />
        </div>
        {pricing.data ? <PlanCards pricing={pricing.data} interval={f.interval} church={f.orgType === "CHURCH"} selected={planId} onSelect={(id) => setF({ ...f, planId: id })} compact />
          : pricing.error ? <p className="text-sm text-bad">{(pricing.error as Error).message}</p> : <Spinner />}
        <p className="mt-2 text-[11px] text-ink-faint">
          {f.orgType === "CHURCH" && (pricing.data?.churchDiscountBps ?? 0) > 0 ? `Churches get ${(pricing.data!.churchDiscountBps / 100)}% off automatically. ` : ""}
          You won&apos;t be charged during the trial, and you can change plans later.
        </p>
      </div>
      {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !planId}>{busy && <Spinner />}Create organization</button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
