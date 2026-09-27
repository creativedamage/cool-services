"use client";
/**
 * Page a parent from inside the app: type (or tap) a security code and it shows on the auditorium
 * screens as a ProPresenter message. While a page is on screen, paging is locked for everyone
 * (the app and every iPad) until ProPresenter takes it down.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { BellRing, Check, MonitorUp, Settings2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { CheckInRow, Ministry, PagingStatus } from "@shared/types";
import { Api, ApiError, qk } from "@/lib/api";
import { MINISTRY_LABEL, useOnScreenSeconds } from "@/lib/paging";
import { clock } from "@/lib/format";
import { Spinner } from "@/components/ui";
import { PrefsLink } from "@/components/settings/PrefsLink";

export function usePager() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: qk.paging, queryFn: Api.pagingConfig, staleTime: 60_000 });
  const status = useQuery({
    queryKey: qk.pagingStatus,
    queryFn: Api.pagingStatus,
    // Tick fast while something's on screen so the button unlocks right on time.
    refetchInterval: (q) => (q.state.data?.onScreenUntil ? 1000 : 4000),
  });
  const left = useOnScreenSeconds(status.data, status.dataUpdatedAt);
  const page = useMutation({
    mutationFn: (v: { ministry: Ministry; code: string; childName?: string | null }) => Api.page(v.ministry, v.code, v.childName),
    onSuccess: (r) => {
      qc.setQueryData(qk.pagingStatus, r.status);
      toast.success(`Paged ${MINISTRY_LABEL[r.event.ministry]}: ${r.event.code}`, { description: "On the auditorium screens now." });
    },
    onError: (e) => {
      const st = e instanceof ApiError ? (e.data?.status as PagingStatus | undefined) : undefined;
      if (st) qc.setQueryData(qk.pagingStatus, st);
      toast.error("Couldn’t page", { description: (e as Error).message });
    },
  });
  /** Which ministry a checked-in child belongs to, from each ministry's rooms. */
  const ministryFor = (r: CheckInRow): Ministry | null => {
    const c = config.data;
    if (!c) return null;
    for (const m of ["nursery", "kids"] as Ministry[]) {
      if (c.ministries[m].enabled && r.locationIds.some((id) => c.ministries[m].locationIds.includes(id))) return m;
    }
    return null;
  };
  return { config, status, left, page, ministryFor, ready: Boolean(status.data?.configured) };
}

type Pager = ReturnType<typeof usePager>;

/** Code box + ministry + Page button, with the on-screen countdown. */
export function PagerBar({ pager }: { pager: Pager }) {
  const { config, status, left, page, ready } = pager;
  const enabled = (["nursery", "kids"] as Ministry[]).filter((m) => config.data?.ministries[m].enabled);
  const [ministry, setMinistry] = useState<Ministry>("nursery");
  const m = enabled.includes(ministry) ? ministry : enabled[0] ?? "nursery";
  const [code, setCode] = useState("");
  const current = status.data?.current;
  const locked = left > 0;

  if (!status.data) return null;
  if (!ready) {
    return (
      <div className="panel flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <MonitorUp size={16} className="text-accent" />
        <span className="text-ink-soft">Page parents on the auditorium screens through ProPresenter.</span>
        <PrefsLink section="paging" className="btn-outline ml-auto py-1 text-xs"><Settings2 size={13} /> Set up in Preferences</PrefsLink>
      </div>
    );
  }

  const submit = () => {
    if (!code.trim() || locked) return;
    page.mutate({ ministry: m, code }, { onSuccess: () => setCode("") });
  };

  return (
    <div className={clsx("panel flex flex-wrap items-center gap-3 px-4 py-3 transition", locked && "border-warn/40")}>
      <div className="flex items-center gap-2 text-sm font-semibold"><BellRing size={16} className="text-accent" /> Page a parent</div>
      {enabled.length > 1 && (
        <div className="flex rounded-lg border border-line p-0.5">
          {enabled.map((x) => (
            <button key={x} onClick={() => setMinistry(x)}
              className={clsx("rounded-md px-2.5 py-1 text-xs transition", m === x ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink-soft")}>
              {config.data?.ministries[x].title ?? MINISTRY_LABEL[x]}
            </button>
          ))}
        </div>
      )}
      <input className="input w-36 py-1.5 font-mono uppercase tracking-widest" placeholder="Code" maxLength={8} value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <button className="btn-primary py-1.5" disabled={!code || locked || page.isPending} onClick={submit}>
        {page.isPending ? <Spinner /> : <BellRing size={14} />}
        {locked ? `On screen · ${left}s` : "Page the auditorium"}
      </button>
      <div className="ml-auto text-xs text-ink-muted">
        {locked && current ? (
          <span className="inline-flex items-center gap-1.5 text-warn">
            <span className="h-2 w-2 animate-pulse rounded-full bg-warn" />
            Showing {MINISTRY_LABEL[current.ministry]} <b className="font-mono">{current.code}</b> for {left}s more
          </span>
        ) : <RecentPages status={status.data} />}
      </div>
    </div>
  );
}

function RecentPages({ status }: { status: PagingStatus }) {
  const last = status.recent[0];
  if (!last) return <span>Nothing paged today</span>;
  return (
    <span className="inline-flex items-center gap-1.5" title={status.recent.slice(0, 10).map((e) => `${clock(e.at)} ${e.code} · ${e.by}${e.ok ? "" : ` (failed: ${e.error})`}`).join("\n")}>
      {last.ok ? <Check size={12} className="text-ok" /> : <X size={12} className="text-bad" />}
      Last: <b className="font-mono text-ink-soft">{last.code}</b> at {clock(last.at)} · {last.by}
      {status.recent.length > 1 && <span className="text-ink-faint">(+{status.recent.length - 1} today)</span>}
    </span>
  );
}

/** Small "Page" button on a checked-in child's row. */
export function PageChildButton({ pager, row }: { pager: Pager; row: CheckInRow }) {
  const m = pager.ministryFor(row);
  if (!pager.ready || !row.securityCode || row.checkedOutAt || row.kind === "Volunteer" || !m) return null;
  const locked = pager.left > 0;
  const busy = pager.page.isPending && pager.page.variables?.code === row.securityCode;
  return (
    <button disabled={locked || pager.page.isPending}
      onClick={() => pager.page.mutate({ ministry: m, code: row.securityCode!, childName: row.name })}
      title={locked ? `A page is on screen (${pager.left}s)` : `Show ${row.securityCode} on the auditorium screens`}
      className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-soft transition hover:border-accent/50 hover:text-accent disabled:opacity-40">
      {busy ? <Spinner size={10} /> : <BellRing size={11} />} Page
    </button>
  );
}
