"use client";
/**
 * Watch other services (other campuses' service types, or your own other services) while you run
 * yours: where each one is in Planning Center Live and whether it's running over or under.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ExternalLink, Radio, X } from "lucide-react";
import Link from "next/link";
import type { PlanSummary } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { routes } from "@/lib/routes";
import { actuals, delta, mmssAny } from "@/lib/runsheet";

export function WatchPanel({ candidates, watching, setWatching, now, onClose }: {
  candidates: PlanSummary[]; watching: string[]; setWatching: (ids: string[]) => void; now: number; onClose: () => void;
}) {
  const shown = candidates.filter((p) => watching.includes(p.id));
  const others = candidates.filter((p) => !watching.includes(p.id));
  return (
    <aside className="no-print fixed bottom-0 right-0 top-0 z-40 flex w-[340px] flex-col border-l border-line bg-surface shadow-2xl">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold"><Radio size={14} className="text-accent" /> Watch other services</div>
        <button className="btn-ghost p-1" onClick={onClose}><X size={14} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {shown.map((p) => <WatchCard key={p.id} p={p} now={now} onRemove={() => setWatching(watching.filter((x) => x !== p.id))} />)}
        {!shown.length && <p className="px-1 text-xs text-ink-muted">Pick services below to follow their Live position here.</p>}
        {others.length > 0 && (
          <div className="pt-2">
            <div className="label mb-1 px-1">Same day</div>
            {others.map((p) => (
              <button key={p.id} onClick={() => setWatching([...watching, p.id])}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-soft hover:bg-hover/60">
                <span className="min-w-0"><span className="block truncate">{p.title}</span><span className="block truncate text-[10px] text-ink-faint">{p.serviceTypeName}</span></span>
                <span className="text-[11px] text-accent">Watch</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function WatchCard({ p, now, onRemove }: { p: PlanSummary; now: number; onRemove: () => void }) {
  const data = useQuery({ queryKey: qk.runSheet(p.id), queryFn: () => Api.runSheet(p.serviceTypeId, p.id), refetchInterval: 30_000 });
  const live = useQuery({ queryKey: qk.live(p.id), queryFn: () => Api.live(p.serviceTypeId, p.id), refetchInterval: 4_000, retry: false });
  const times = useQuery({ queryKey: qk.itemTimes(p.id), queryFn: () => Api.itemTimes(p.serviceTypeId, p.id), refetchInterval: 15_000, retry: false });
  const plan = data.data?.plan;
  const l = live.data;
  const cur = plan?.items.find((i) => i.id === l?.currentItemId);
  const el = l?.currentStartedAt ? Math.max(0, (now - Date.parse(l.currentStartedAt)) / 1000) : null;

  // Over/under: when the current item actually started vs when it was planned to, in the running service time.
  let drift: number | null = null;
  if (plan && cur) {
    const svc = plan.times.filter((t) => t.kind === "service");
    const running = svc.find((t) => times.data?.[cur.id]?.[t.id]?.start && !times.data?.[cur.id]?.[t.id]?.end) ?? svc.find((t) => Date.parse(t.endsAt || t.startsAt) > now) ?? svc[0];
    if (running) {
      const act = actuals(plan, times.data, running.id).get(cur.id);
      const pre = plan.items.filter((i) => i.servicePosition === "pre").reduce((n, i) => n + i.lengthSec, 0);
      let planned = -pre;
      for (const i of plan.items) { if (i.id === cur.id) break; planned += i.lengthSec; }
      if (act?.startOff != null) drift = act.startOff - planned;
    }
  }
  const over = el != null && cur?.lengthSec ? el - cur.lengthSec : null;

  return (
    <div className="rounded-xl border border-line bg-raised p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-ink-muted">{p.serviceTypeName}</div>
          <div className="truncate text-sm font-semibold">{p.title}</div>
        </div>
        <Link href={routes.runSheet(p.serviceTypeId, p.id)} className="btn-ghost p-1" title="Open its run sheet"><ExternalLink size={12} /></Link>
        <button className="btn-ghost p-1" title="Stop watching" onClick={onRemove}><X size={12} /></button>
      </div>
      {!l?.currentItemId ? (
        <div className="mt-2 text-xs text-ink-faint">Live hasn’t started</div>
      ) : (
        <div className="mt-2">
          <div className="flex items-center gap-1.5 text-xs text-accent"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> <span className="truncate font-medium">{cur?.title ?? "…"}</span></div>
          <div className="mt-1 flex items-center gap-3 font-mono text-[11px] tabular-nums">
            {el != null && <span className={clsx(over != null && over > 0 ? "text-bad" : "text-ink-soft")}>{mmssAny(el)}{cur?.lengthSec ? ` / ${mmssAny(cur.lengthSec)}` : ""}</span>}
            {drift != null && <span className={clsx("rounded px-1", drift > 30 ? "bg-bad-soft text-bad" : drift < -30 ? "bg-ok-soft text-ok" : "bg-hover text-ink-muted")} title="Where the service is vs its plan">{delta(drift)} {drift >= 0 ? "behind" : "ahead"}</span>}
          </div>
          {l.controller && <div className="mt-1 truncate text-[10px] text-ink-faint">Live: {l.controller}</div>}
        </div>
      )}
    </div>
  );
}
