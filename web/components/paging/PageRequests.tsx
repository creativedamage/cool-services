"use client";
/**
 * Page requests from the Kids & Nursery iPads, waiting for you to send them. A bar across the top of
 * every Cool Services screen: send one, send all, or cancel. Sent requests go on the ProPresenter
 * screens as soon as nothing else is showing, one after another.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { BellRing, Check, ChevronDown, Loader2, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { PageRequest, PagingStatus } from "@shared/types";
import { Api, qk } from "@/lib/api";

const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 45 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
};

export function PageRequestsBar() {
  const qc = useQueryClient();
  const st = useQuery({ queryKey: qk.pagingStatus, queryFn: Api.pagingStatus, refetchInterval: 2000, refetchIntervalInBackground: true, retry: false });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  const [open, setOpen] = useState(false);
  const act = useMutation({
    mutationFn: ({ id, what }: { id?: string; what: "send" | "cancel" | "all" }) =>
      what === "all" ? Api.sendAllPageRequests() : what === "send" ? Api.sendPageRequest(id!) : Api.cancelPageRequest(id!),
    onSuccess: (s: PagingStatus) => qc.setQueryData(qk.pagingStatus, s),
    onError: (e) => toast.error("Couldn’t do that", { description: (e as Error).message }),
  });

  const all = st.data?.requests ?? [];
  const waiting = all.filter((r) => r.state === "waiting").reverse(); // oldest first
  const going = all.filter((r) => r.state === "released").reverse();
  const failed = all.filter((r) => r.state === "failed" && now - Date.parse(r.doneAt ?? r.requestedAt) < 10 * 60_000);

  // Count in the window title too, so it shows in the Dock menu / Mission Control.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = waiting.length ? `(${waiting.length}) ${base}` : base;
  }, [waiting.length]);

  if (!waiting.length && !going.length && !failed.length) return null;
  const first = waiting[0] ?? going[0] ?? failed[0];
  const more = waiting.length + going.length + failed.length - 1;
  const onScreen = st.data?.onScreenUntil ? Math.max(0, Math.ceil((Date.parse(st.data.onScreenUntil) - now) / 1000)) : 0;

  return (
    <div className={clsx("no-print z-40 border-b", waiting.length ? "border-warn/50 bg-warn-soft" : "border-line bg-surface")}>
      <div className="flex items-center gap-3 px-5 py-2.5">
        <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-full", waiting.length ? "animate-pulse bg-warn text-black" : "bg-accent-soft text-accent")}>
          <BellRing size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <Line r={first} now={now} onScreen={onScreen} big />
        </div>
        <RowActions r={first} busy={act.isPending} act={act.mutate} />
        {more > 0 && (
          <>
            {waiting.length > 1 && <button className="btn-outline py-1.5 text-xs" disabled={act.isPending} onClick={() => act.mutate({ what: "all" })}><Send size={13} /> Send all {waiting.length}</button>}
            <button className="btn-ghost py-1.5 text-xs" onClick={() => setOpen(!open)}>+{more} more <ChevronDown size={13} className={clsx("transition", open && "rotate-180")} /></button>
          </>
        )}
      </div>
      {open && more > 0 && (
        <ul className="border-t border-line/60 px-5 py-1.5">
          {[...waiting, ...going, ...failed].filter((r) => r.id !== first.id).map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-1.5">
              <div className="min-w-0 flex-1"><Line r={r} now={now} onScreen={onScreen} /></div>
              <RowActions r={r} busy={act.isPending} act={act.mutate} small />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Line({ r, now, onScreen, big }: { r: PageRequest; now: number; onScreen: number; big?: boolean }) {
  const who = r.by.replace(/ iPad$/, "") || r.ministry;
  return (
    <div className={clsx("flex min-w-0 flex-wrap items-baseline gap-x-2", big ? "text-sm" : "text-xs")}>
      <b className={big ? "text-base" : ""}>{who}</b>
      <span className="text-ink-soft">{r.state === "waiting" ? "is requesting a page" : r.state === "released" ? (onScreen ? `sending after the current page (${onScreen}s)` : "sending…") : "couldn’t be paged"}</span>
      <span className="rounded bg-canvas/70 px-1.5 font-mono font-semibold tracking-wider">{r.code}</span>
      {r.childName && <span className="text-ink-muted">{r.childName}</span>}
      <span className="text-ink-faint">{ago(r.requestedAt, now)}</span>
      {r.state === "failed" && r.error && <span className="text-bad">{r.error}</span>}
    </div>
  );
}

function RowActions({ r, busy, act, small }: { r: PageRequest; busy: boolean; act: (a: { id?: string; what: "send" | "cancel" | "all" }) => void; small?: boolean }) {
  if (r.state === "released") return <span className="flex items-center gap-1 text-xs text-accent"><Loader2 size={13} className="animate-spin" /> Sending</span>;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button className={clsx("btn-primary", small ? "py-1 text-xs" : "py-1.5")} disabled={busy} onClick={() => act({ id: r.id, what: "send" })}>
        {r.state === "failed" ? "Try again" : <><Check size={14} /> Send now</>}
      </button>
      <button className={clsx("btn-ghost", small ? "py-1 text-xs" : "py-1.5")} disabled={busy} onClick={() => act({ id: r.id, what: "cancel" })} title="Don’t send this page"><X size={14} /> {small ? "" : "Cancel"}</button>
    </div>
  );
}
