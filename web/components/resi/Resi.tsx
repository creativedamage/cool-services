"use client";
/**
 * Resi (resi.io): the live badge on the Services pages and the Dashboard widget. Status comes from
 * Sundays' server, which asks Resi every 10 seconds (read-only; Preferences → Video → Resi).
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Radio } from "lucide-react";
import { useEffect, useState } from "react";
import type { ResiEncoder, ResiStatus } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { PrefsLink } from "@/components/settings/PrefsLink";
import { Frame } from "@/components/dashboard/Widgets";

export const useResi = () => useQuery({ queryKey: qk.resi, queryFn: Api.resi, refetchInterval: 10_000, staleTime: 5_000 });

const DEST: Record<string, string> = { EMBED: "Web", FACEBOOK: "Facebook", YOUTUBE: "YouTube", RTMP: "RTMP" };
const destLabel = (d: { name: string; type: string | null }) => (d.type && DEST[d.type.toUpperCase()] && d.name.toUpperCase() === d.type.toUpperCase() ? DEST[d.type.toUpperCase()] : d.name);

function useTick(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
const elapsed = (from: string, now: number) => {
  const s = Math.max(0, Math.floor((now - Date.parse(from)) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};

/** "● RESI LIVE 12:34" while Resi is streaming (nothing when it isn't, or Resi isn't set up). */
export function ResiBadge({ className }: { className?: string }) {
  const r = useResi().data;
  const now = useTick();
  if (!r?.configured || !r.connected) return null;
  const starting = !r.live && r.encoders.some((e) => e.state === "starting" || e.state === "setting-up");
  if (!r.live && !starting) return null;
  const names = r.encoders.filter((e) => e.live || e.state === "starting").map((e) => e.title || e.name).join(", ");
  return (
    <span title={`Resi: ${names}`} className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
      r.live ? "bg-rose-600 text-white" : "bg-amber-500/90 text-black", className)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", r.live ? "animate-pulse bg-white" : "bg-black/70")} />
      Resi {r.live ? "live" : "starting"}
      {r.live && r.liveSince && <span className="font-mono font-normal normal-case tabular-nums opacity-90">{elapsed(r.liveSince, now)}</span>}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  STARTED: "text-ok", STARTING: "text-warn", SET_UP: "text-warn", STOPPING: "text-warn", ERROR: "text-bad", ABORTED: "text-bad", STOPPED: "text-ink-faint", IDLE: "text-ink-faint",
};
const STATE_LABEL: Record<ResiEncoder["state"], string> = { live: "Live", starting: "Starting", "setting-up": "Setting up", error: "Error", off: "Off air" };

/* ── Dashboard widget ── */
export function ResiWidget() {
  const q = useResi();
  const r: ResiStatus | undefined = q.data;
  const now = useTick();
  const right = r?.live
    ? <span className="flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live</span>
    : r?.configured && r.connected ? <span className="text-[10px] font-normal text-ink-faint">Off air</span> : null;
  return (
    <Frame title="Resi" icon={Radio} right={right} className={r?.live ? "ring-1 ring-rose-600/60" : undefined}>
      {!r ? null : !r.configured ? (
        <div className="grid h-full place-items-center text-center text-sm text-ink-faint">
          <div>Connect Resi to see when you’re live.<br /><PrefsLink section="resi" className="text-accent hover:underline">Preferences → Video → Resi</PrefsLink></div>
        </div>
      ) : !r.connected ? (
        <div className="text-sm text-bad">{r.error ?? "Can’t reach Resi."} <PrefsLink section="resi" className="text-accent hover:underline">Check Preferences</PrefsLink></div>
      ) : (
        <div className="flex h-full flex-col gap-2">
          {r.live && r.liveSince && (
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-semibold tabular-nums text-rose-500">{elapsed(r.liveSince, now)}</span>
              <span className="text-xs text-ink-muted">live since {new Date(r.liveSince).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
            </div>
          )}
          {!r.live && <div className="text-sm text-ink-muted">Not streaming.{r.lastLive ? ` Last live ${new Date(r.lastLive.from).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })} for ${elapsed(r.lastLive.from, Date.parse(r.lastLive.to))}.` : ""}</div>}
          <div className="space-y-1.5">
            {r.encoders.map((e) => (
              <div key={e.id} className={clsx("rounded-lg border px-2.5 py-1.5", e.live ? "border-rose-600/40 bg-rose-600/10" : e.state === "error" ? "border-bad/40" : "border-line bg-raised")}>
                <div className="flex items-center gap-2 text-xs">
                  <span className={clsx("h-2 w-2 rounded-full", e.live ? "animate-pulse bg-rose-500" : e.state === "error" ? "bg-bad" : e.state === "off" ? "bg-ink-faint/50" : "bg-warn")} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{e.name}</span>
                  <span className="text-ink-muted">{STATE_LABEL[e.state]}{e.live && e.liveSince ? ` · ${elapsed(e.liveSince, now)}` : ""}</span>
                </div>
                {e.title && <div className="mt-0.5 truncate text-[11px] text-ink-soft">{e.title}</div>}
                {e.destinations.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                    {e.destinations.map((d, i) => (
                      <span key={i} className="flex items-center gap-1"><span className="text-ink-soft">{destLabel(d)}</span><span className={STATUS_TONE[d.status] ?? "text-ink-muted"}>{d.status.toLowerCase().replace(/_/g, " ")}</span></span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!r.encoders.length && <div className="text-xs text-ink-faint">No encoders on this Resi account.</div>}
          </div>
          <div className="mt-auto flex items-center justify-between text-[10px] text-ink-faint">
            <span>{r.checkedAt ? `Checked ${new Date(r.checkedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : ""}</span>
            <a href="https://studio.resi.io" target="_blank" rel="noreferrer" className="hover:text-accent">Resi Studio ↗</a>
          </div>
        </div>
      )}
    </Frame>
  );
}
