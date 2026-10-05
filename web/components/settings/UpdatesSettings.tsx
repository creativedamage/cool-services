"use client";
/** Settings → Updates: the version you have, Check for Updates, and Update Now. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import type { UpdateStatus } from "@shared/updates";
import { Api, qk } from "@/lib/api";
import { Spinner } from "@/components/ui";

export function useUpdates() {
  return useQuery({
    queryKey: qk.updates,
    queryFn: Api.updates,
    refetchInterval: (q) => (["downloading", "installing", "checking"].includes(q.state.data?.state ?? "") ? 700 : 5 * 60_000),
  });
}

export function UpdatesSettings() {
  const qc = useQueryClient();
  const st = useUpdates();
  const set = (s: UpdateStatus) => qc.setQueryData(qk.updates, s);
  const check = useMutation({ mutationFn: Api.checkUpdates, onSuccess: set });
  const install = useMutation({ mutationFn: Api.installUpdate, onSuccess: set });
  useEffect(() => {
    if (location.hash === "#updates") setTimeout(() => document.getElementById("updates")?.scrollIntoView({ behavior: "smooth" }), 80);
  }, []);
  // Start polling right away once an install is under way.
  useEffect(() => { if (install.isPending) void st.refetch(); }, [install.isPending]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = st.data;
  const busy = s && ["checking", "downloading", "installing"].includes(s.state);
  const pct = s?.progress != null ? Math.round(s.progress * 100) : null;

  return (
    <section id="updates" className="panel scroll-mt-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><RefreshCw size={16} /> Updates</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            You have Sundays <b className="text-ink-soft">{s?.current ?? "…"}</b>.
            {s?.repo && <> New versions come from <a className="underline" href={`https://github.com/${s.repo}/releases`} target="_blank" rel="noreferrer">GitHub</a>, and it checks on its own every few hours.</>}
          </p>
        </div>
        <button className="btn-outline shrink-0" disabled={!s || s.state === "unavailable" || Boolean(busy)} onClick={() => check.mutate()}>
          {s?.state === "checking" ? <Spinner /> : <RefreshCw size={14} />} Check for updates
        </button>
      </div>

      {s && (
        <div className={clsx("mt-3 rounded-lg border px-3 py-2 text-xs",
          s.state === "error" || s.state === "unavailable" ? "border-bad/30 bg-bad-soft text-bad"
            : s.state === "available" ? "border-accent/30 bg-accent-soft text-accent"
            : s.state === "up-to-date" ? "border-ok/30 bg-ok-soft text-ok" : "border-line text-ink-muted")}>
          {s.state === "unavailable" ? s.error
            : s.state === "error" ? s.error
            : s.state === "checking" ? "Checking GitHub…"
            : s.state === "up-to-date" ? `You’re up to date.${s.checkedAt ? ` Checked ${new Date(s.checkedAt).toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}.` : ""}`
            : s.state === "available" ? `Sundays ${s.latest?.version} is available.`
            : s.state === "downloading" ? `Downloading ${s.latest?.version}… ${pct ?? 0}%`
            : s.state === "installing" ? "Installing. Sundays will close and reopen in a moment."
            : "Not checked yet."}
        </div>
      )}

      {s?.state === "downloading" && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct ?? 0}%` }} />
        </div>
      )}

      {s?.latest && (s.state === "available" || s.state === "downloading" || s.state === "installing") && (
        <div className="mt-4 rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">What’s new in {s.latest.version}</div>
              <div className="text-[11px] text-ink-muted">Released {new Date(s.latest.publishedAt).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}</div>
            </div>
            <a className="btn-ghost py-1 text-xs" href={s.latest.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> On GitHub</a>
          </div>
          {s.latest.notes && <div className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-soft">{s.latest.notes}</div>}
          {s.installProblem ? (
            <p className="mt-3 text-xs text-warn">{s.installProblem}</p>
          ) : (
            <button className="btn-primary mt-4" disabled={s.state !== "available" || install.isPending} onClick={() => install.mutate()}>
              {s.state === "available" ? <Download size={14} /> : <Spinner />}
              {s.state === "available" ? `Update now to ${s.latest.version}` : "Updating…"}
            </button>
          )}
          <p className="mt-2 text-[11px] text-ink-faint">Sundays restarts to finish. Your sign-in, settings and notes stay as they are.</p>
        </div>
      )}
    </section>
  );
}
