"use client";
/** One request: details, the timeline, and the next steps you can take. */
import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { KIND_LABEL, labelStatus, REQUEST_ACTIONS, type RequestAction } from "@shared/ops/workflow";
import type { RequestDetail } from "@shared/ops/types";
import { fmtDate, fmtDateTime, fmtMoney, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Loading, PageHeader, Pill, PriorityBadge, RequestStatusBadge } from "@/components/ops/OpsUi";

export default function Page() { return <Suspense><RequestView /></Suspense>; }

const EVENT_TEXT: Record<string, string> = {
  SUBMIT: "Submitted", APPROVE: "Approved", DENY: "Denied", ASSIGN: "Assigned", START: "Started work", HOLD: "Put on hold",
  ORDER: "Marked ordered", COMPLETE: "Completed", CANCEL: "Cancelled", REOPEN: "Reopened", COMMENT: "commented",
};

function RequestView() {
  const id = useSearchParams().get("id") ?? "";
  const d = useOps<RequestDetail>(id ? `/requests/${id}` : null);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const { request: r, actions, staffSide, timeline, teamMembers } = d.data;
  const info: [string, string][] = [
    ["Campus", r.campus.name], ["Location", r.location ?? "—"], ["Requested by", r.requester.name], ["Submitted", fmtDateTime(r.createdAt)],
    ["Needed by", fmtDate(r.neededBy)], ["Team", r.assignedTeam?.name ?? "Not routed"], ["Assignee", r.assignee?.name ?? "—"],
    ...(r.category.kind === "TECHNOLOGY" ? [["Quantity", String(r.quantity)] as [string, string]] : []),
    ...(r.estimatedCents ? [["Estimate", fmtMoney(r.estimatedCents)] as [string, string]] : []),
    ...(r.approver ? [[r.status === "DENIED" ? "Denied by" : "Approved by", r.approver.name] as [string, string]] : []),
  ];
  return (
    <>
      <PageHeader crumb={`Requests / ${r.number}`} title={r.title}
        actions={<Link href={staffSide ? "/ops/work" : "/ops/requests"} className="btn-ghost"><ArrowLeft size={15} /> {staffSide ? "Work queue" : "My requests"}</Link>}
        description={<span className="flex flex-wrap items-center gap-3"><RequestStatusBadge status={r.status} /><PriorityBadge priority={r.priority} /><span className="text-ink-muted">{r.category.icon} {r.category.name} · {KIND_LABEL[r.category.kind]}</span></span>} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card eyebrow="Request" title="Details">
            <div className="whitespace-pre-wrap p-4 text-sm">{r.details || <span className="text-ink-faint">No details provided.</span>}</div>
            {r.lines.length > 0 && (
              <ul className="divide-y divide-line border-t border-line text-sm">
                {r.lines.map((l) => <li key={l.id} className="flex justify-between px-4 py-2.5"><span>{l.description}</span><span className="font-mono">{l.quantity} <span className="text-ink-faint">{l.unit ?? ""}</span></span></li>)}
              </ul>
            )}
          </Card>
          <Card eyebrow="Accountability" title="Activity">
            <ol className="relative px-4 py-3">
              {timeline.map((t, i) => (
                <li key={i} className="relative flex gap-3 pb-4 last:pb-1">
                  <span className={clsx("relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-surface", t.kind === "event" ? "bg-accent" : t.internal ? "bg-warn" : "bg-ink-faint")} />
                  {i < timeline.length - 1 && <span className="absolute left-[4.5px] top-4 h-full w-px bg-line" />}
                  <div className="min-w-0 flex-1 text-sm">
                    <div><b className="font-medium">{t.who}</b> <span className={t.kind === "event" ? "text-ink" : "text-ink-muted"}>{(EVENT_TEXT[t.action] ?? t.action).replace(/^\w/, (c) => c.toLowerCase())}</span>
                      {t.kind === "event" && t.action === "SUBMIT" && t.toStatus && <span className="text-ink-muted"> — {labelStatus(t.toStatus as never)}</span>}
                      {t.internal && <Pill tone="warn">internal</Pill>}
                      <span className="ml-2 text-[11px] text-ink-faint">{fmtDateTime(t.at)}</span></div>
                    {t.note && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-hover/60 px-3 py-2 text-ink-soft">{t.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
            {r.status !== "CANCELLED" && <CommentBox id={r.id} canInternal={staffSide} />}
          </Card>
        </div>
        <aside className="space-y-5">
          <Card eyebrow="Next step" title="Actions" pad><Actions id={r.id} actions={actions} members={teamMembers} assigneeId={r.assigneeId} /></Card>
          <Card eyebrow="Info">
            <dl className="divide-y divide-line text-sm">
              {info.map(([k, v]) => <div key={k} className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-ink-muted">{k}</dt><dd className="text-right">{v}</dd></div>)}
            </dl>
          </Card>
          {!r.assignedTeamId && staffSide && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">No team is routed for this request type at {r.campus.name}. Set one under Settings → Request types.</p>}
        </aside>
      </div>
    </>
  );
}

function Actions({ id, actions, members, assigneeId }: { id: string; actions: RequestAction[]; members: { id: string; name: string }[]; assigneeId: string | null }) {
  const refresh = useOpsRefresh();
  const [pending, setPending] = useState<RequestAction | null>(null);
  const [note, setNote] = useState("");
  const [who, setWho] = useState(assigneeId ?? members[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!actions.length) return <p className="text-xs text-ink-faint">Nothing for you to do here right now.</p>;
  const run = async (action: RequestAction) => {
    setBusy(true); setError(null);
    try {
      await ops(`/requests/${id}/actions`, { json: { action, note: note || undefined, assigneeId: action === "ASSIGN" ? who : undefined } });
      toast.success(REQUEST_ACTIONS[action].label);
      setPending(null); setNote("");
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const needsForm = (a: RequestAction) => a === "ASSIGN" || a === "APPROVE" || Boolean(REQUEST_ACTIONS[a].noteRequired);
  const primary: RequestAction[] = ["APPROVE", "START", "COMPLETE"];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button key={a} disabled={busy} onClick={() => (needsForm(a) ? setPending(pending === a ? null : a) : void run(a))}
            className={a === "DENY" || a === "CANCEL" ? "btn-ghost text-bad" : primary.includes(a) ? "btn-primary" : "btn-outline"}>{REQUEST_ACTIONS[a].label}</button>
        ))}
      </div>
      {pending && (
        <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
          {pending === "ASSIGN" && (
            <select className="input" value={who} onChange={(e) => setWho(e.target.value)}>
              {!members.length && <option value="">Nobody on the team yet</option>}
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          <textarea rows={2} className="input" placeholder={REQUEST_ACTIONS[pending].noteRequired ? "Note (required)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button className={pending === "DENY" ? "btn bg-bad text-white" : "btn-primary"} disabled={busy} onClick={() => void run(pending)}>{REQUEST_ACTIONS[pending].label}</button>
            <button className="btn-ghost" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

function CommentBox({ id, canInternal }: { id: string; canInternal: boolean }) {
  const refresh = useOpsRefresh();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-2 border-t border-line p-4" onSubmit={async (e) => {
      e.preventDefault();
      if (!body.trim()) return;
      setBusy(true);
      try { await ops(`/requests/${id}/comments`, { json: { body, internal } }); setBody(""); await refresh(); }
      catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
    }}>
      <textarea rows={3} className="input" placeholder="Add a comment…" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex items-center justify-between">
        {canInternal ? <label className="flex items-center gap-2 text-xs text-ink-muted"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (team only)</label> : <span />}
        <button className="btn-outline" disabled={busy || !body.trim()}>Comment</button>
      </div>
    </form>
  );
}
