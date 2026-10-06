"use client";
/** Public pricing: the plans and add-ons the Sundays super admins have set up (live). */
import { ArrowRight, Building2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { fmtPrice, type Interval } from "@shared/ops/billing";
import { IntervalToggle, PlanCards, usePricing } from "@/components/ops/Plans";
import { Spinner } from "@/components/ui";
import { Check } from "@/components/ops/OpsUi";

export default function Pricing() {
  const pricing = usePricing();
  const [interval, setInterval] = useState<Interval>("MONTHLY");
  const [church, setChurch] = useState(true);
  const addOns = pricing.data?.modules.filter((m) => m.priceMonthlyCents > 0) ?? [];
  return (
    <div className="app-ops min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-on-accent"><Building2 size={16} /></span>
          <span className="text-sm font-semibold">Sundays <span className="font-normal text-ink-faint">|</span> Operations</span>
        </Link>
        <Link href="/ops" className="btn-outline">Sign in</Link>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <section className="py-10 text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Run your church&apos;s operations in one place</h1>
          <p className="mx-auto mt-3 max-w-2xl text-ink-muted">Requests, approvals and work orders for technology, supplies and facilities, with AVL quoting when you need it. Start with a free trial.</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <IntervalToggle value={interval} onChange={setInterval} />
            <Check label="We're a church" checked={church} onChange={setChurch} />
          </div>
          {church && (pricing.data?.churchDiscountBps ?? 0) > 0 && <p className="mt-3 text-sm text-ok">Churches get {pricing.data!.churchDiscountBps / 100}% off every plan, automatically.</p>}
        </section>
        {pricing.data ? <PlanCards pricing={pricing.data} interval={interval} church={church} /> : pricing.error ? <p className="text-center text-bad">{(pricing.error as Error).message}</p> : <div className="grid place-items-center py-10"><Spinner size={18} /></div>}
        <div className="mt-8 text-center"><Link href="/ops" className="btn-primary inline-flex px-5 py-2.5">Start your free trial <ArrowRight size={15} /></Link></div>
        {addOns.length > 0 && (
          <section className="mx-auto mt-14 max-w-3xl">
            <h2 className="text-center text-lg font-semibold">Add-ons</h2>
            <p className="mt-1 text-center text-sm text-ink-muted">Add any module your plan doesn&apos;t include.</p>
            <ul className="mt-5 divide-y divide-line rounded-xl border border-line">
              {addOns.map((m) => (
                <li key={m.key} className="flex items-center gap-4 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1"><span className="font-medium">{m.name}</span>{m.description && <span className="block text-xs text-ink-muted">{m.description}</span>}</span>
                  <span className="whitespace-nowrap tabular-nums">{fmtPrice(interval === "YEARLY" ? m.priceYearlyCents : m.priceMonthlyCents)} <span className="text-xs text-ink-muted">/ {interval === "YEARLY" ? "year" : "month"}</span></span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
