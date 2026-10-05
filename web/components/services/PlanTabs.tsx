"use client";
import clsx from "clsx";
import { CalendarDays, ScrollText, UserCheck } from "lucide-react";
import Link from "next/link";
import { routes } from "@/lib/routes";
import { serviceLocked, useAppMode } from "@/lib/appMode";

/** Plan · Check-ins · Run sheet, for the service you're on. */
export function PlanTabs({ st, plan, active }: { st: string; plan: string; active: "plan" | "checkins" }) {
  const tabs = [
    { key: "plan", label: "Plan", icon: CalendarDays, href: routes.plan(st, plan) },
    { key: "checkins", label: "Check-ins", icon: UserCheck, href: routes.checkins(st, plan) },
    { key: "runsheet", label: "Run sheet", icon: ScrollText, href: routes.runSheet(st, plan) },
  ] as const;
  const locked = serviceLocked(useAppMode().data); // Service Mode: no Check-ins tab
  return (
    <div className="no-print flex gap-1">
      {tabs.filter((t) => !(locked && t.key === "checkins")).map(({ key, label, icon: Icon, href }) => (
        <Link key={key} href={href}
          className={clsx("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition",
            active === key ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-hover hover:text-ink-soft")}>
          <Icon size={14} /> {label}
        </Link>
      ))}
    </div>
  );
}

/** Compact header used on Check-ins: date, title, tabs. */
export function PlanHeader({ st, plan, active, date, title, typeName, right }: {
  st: string; plan: string; active: "plan" | "checkins";
  date?: string; title?: string; typeName?: string; right?: React.ReactNode;
}) {
  return (
    <section className="no-print border-b border-line px-8 pb-4 pt-5">
      <div className="flex flex-wrap items-end gap-4 pr-24">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-ink-muted">{typeName ?? "Service"}</div>
          <div className="mt-0.5 flex items-baseline gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{title ?? "…"}</h1>
            {date && <span className="text-sm font-medium text-accent">{new Date(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>}
          </div>
        </div>
        {right}
      </div>
      <div className="mt-4"><PlanTabs st={st} plan={plan} active={active} /></div>
    </section>
  );
}
