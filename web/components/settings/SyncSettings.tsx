"use client";
/** Preferences → About: settings sync across every Mac you sign in on. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { Api, qk } from "@/lib/api";

const ago = (iso: string) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 10 ? "just now" : s < 90 ? `${s} seconds ago` : s < 5400 ? `${Math.round(s / 60)} minutes ago` : new Date(iso).toLocaleString();
};

export function SyncSettings() {
  const qc = useQueryClient();
  const st = useQuery({ queryKey: qk.sync, queryFn: Api.syncStatus, refetchInterval: 10_000 });
  const now = useMutation({ mutationFn: Api.syncNow, onSuccess: (s) => { qc.setQueryData(qk.sync, s); void qc.invalidateQueries(); } });
  const s = st.data;
  if (!s?.enabled) return null;
  const ok = s.state === "ok" || s.state === "syncing" || s.state === "idle";
  return (
    <section className="panel p-5">
      <div className="flex items-start gap-3">
        <div className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", ok ? "bg-accent-soft text-accent" : "bg-warn-soft text-warn")}>
          {ok ? <Cloud size={18} /> : <CloudOff size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Sync across your Macs</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Sign in to Sundays with Planning Center on another Mac and it gets the same setup: Preferences, mics and packs, the Mic board and Clock,
            the Dashboard, campuses, team groups, Parent paging, ProPresenter computers, the console, Smaart, Resi, the mic board’s backgrounds and the weekend you picked.
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            Each Mac keeps its own: Full / Service Mode / FOH Companion and the Service Mode PIN, which screens and network pages it shows, its MIDI output
            and its FOH companion links.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className={clsx(s.state === "error" ? "text-bad" : s.state === "signed-out" ? "text-warn" : "text-ink-soft")}>
              {s.state === "signed-out" ? "Sign in with Planning Center to sync (sample data and a shared access token don’t sync)."
                : s.state === "error" ? `Couldn’t sync: ${s.error}`
                : s.state === "syncing" ? "Syncing…"
                : s.lastSync ? <>Synced {ago(s.lastSync)}{s.who ? <> as <b className="text-ink">{s.who}</b></> : null}</> : "Not synced yet"}
            </span>
            <button className="btn-ghost px-2 py-1 text-xs" disabled={now.isPending || s.state === "signed-out"} onClick={() => now.mutate()}>
              <RefreshCw size={13} className={clsx(now.isPending && "animate-spin")} /> Sync now
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
