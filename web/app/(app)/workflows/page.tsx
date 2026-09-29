"use client";
/**
 * Workflows: the ones assigned or shared to you, access requests waiting on you, and (for People
 * managers) everything else. Workflows you aren't on are locked, with Request access.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertCircle, ArrowUpRight, ChevronDown, Lock, Send, Share2, UserCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { WorkflowSummary } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { Skeleton } from "@/components/ui";
import { routes } from "@/lib/routes";
import { RequestAccessModal, RequestRow, ShareModal, requestsKey } from "@/components/workflows/WorkflowAccess";

export default function WorkflowsIndex() {
  const { data, isLoading } = useQuery({ queryKey: qk.workflows, queryFn: Api.workflows });
  const requests = useQuery({ queryKey: requestsKey, queryFn: Api.workflowRequests, refetchInterval: 30_000 });
  const [share, setShare] = useState<WorkflowSummary | null>(null);
  const [ask, setAsk] = useState<WorkflowSummary | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const mine = (data ?? []).filter((w) => w.mine);
  const open = (data ?? []).filter((w) => !w.mine && w.canOpen);
  const locked = (data ?? []).filter((w) => !w.canOpen);
  const pendingMine = new Map((requests.data?.mine ?? []).filter((r) => r.state === "pending").map((r) => [r.workflowId, r]));
  const toReview = requests.data?.toReview ?? [];

  return (
    <div className="overflow-y-auto p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
      <p className="mt-1 text-sm text-ink-muted">The Planning Center People workflows assigned or shared to you. Pick one to open it as a board.</p>

      {toReview.length > 0 && (
        <section className="mt-6">
          <h2 className="label mb-2 flex items-center gap-1.5"><UserCheck size={13} /> Access requests</h2>
          <div className="max-w-3xl space-y-2">{toReview.map((r) => <RequestRow key={r.id} r={r} />)}</div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="label mb-2">My workflows</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}
          {mine.map((w) => <Tile key={w.id} w={w} onShare={() => setShare(w)} />)}
          {data && !mine.length && (
            <p className="col-span-full text-sm text-ink-muted">Nothing is assigned or shared to you yet.{locked.length ? " Ask for one of the workflows below." : ""}</p>
          )}
        </div>
      </section>

      {open.length > 0 && (
        <section className="mt-8">
          <button className="label mb-2 flex items-center gap-1 hover:text-ink" onClick={() => setShowOthers(!showOthers)}>
            <ChevronDown size={13} className={clsx("transition", !showOthers && "-rotate-90")} /> Other workflows ({open.length}) · you can see these as a People manager
          </button>
          {showOthers && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {open.map((w) => <Tile key={w.id} w={w} onShare={() => setShare(w)} />)}
            </div>
          )}
        </section>
      )}

      {locked.length > 0 && (
        <section className="mt-8">
          <h2 className="label mb-2">Other workflows</h2>
          <ul className="max-w-3xl divide-y divide-line/60 rounded-xl border border-line">
            {locked.map((w) => {
              const pending = pendingMine.get(w.id);
              return (
                <li key={w.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Lock size={14} className="text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{w.name}</span>
                  {pending
                    ? <span className="text-xs text-accent">Requested · waiting for a manager</span>
                    : <button className="btn-outline py-1 text-xs" onClick={() => setAsk(w)}><Send size={12} /> Request access</button>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {share && <ShareModal workflow={share} onClose={() => setShare(null)} />}
      {ask && <RequestAccessModal workflow={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

function Tile({ w, onShare }: { w: WorkflowSummary; onShare: () => void }) {
  return (
    <div className="panel group relative p-4 transition hover:border-line-strong hover:bg-raised">
      <Link href={routes.board(w.id)} className="absolute inset-0" aria-label={`Open ${w.name}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium">{w.name}</div>
        <div className="relative flex items-center gap-1">
          {w.canManage && <button className="btn-ghost p-1 text-ink-faint hover:text-accent" title="Share" onClick={onShare}><Share2 size={14} /></button>}
          <ArrowUpRight size={16} className="text-ink-faint transition group-hover:text-accent" />
        </div>
      </div>
      <div className="mt-5 flex items-end gap-5">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{w.readyCount}</div>
          <div className="text-xs text-ink-muted">ready cards</div>
        </div>
        {w.myReadyCount > 0 && (
          <div>
            <div className="text-2xl font-semibold tabular-nums text-accent">{w.myReadyCount}</div>
            <div className="text-xs text-ink-muted">assigned to you</div>
          </div>
        )}
        {w.overdueCount > 0 && (
          <div className="mb-0.5 flex items-center gap-1 whitespace-nowrap text-xs text-bad"><AlertCircle size={13} /> {w.overdueCount} overdue</div>
        )}
        {w.myShare && w.myShare !== "No Access" && <span className="mb-0.5 ml-auto text-[11px] text-ink-faint">{w.myShare}</span>}
      </div>
    </div>
  );
}
