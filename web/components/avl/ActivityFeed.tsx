"use client";
/**
 * Activity on a lead, client or job: what happened (notes, calls, emails, meetings, site visits)
 * and what's next (follow-ups with a date). Open follow-ups stay pinned on top until ticked off.
 */
import clsx from "clsx";
import { ArrowRightLeft, CalendarClock, Check, Footprints, Mail, Phone, StickyNote, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ACTIVITY_KINDS, type Activity, type ActivityKind, type Ref } from "@shared/ops/crm";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { useOpsUser } from "@/components/ops/context";
import { Card, Empty, Loading } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";

export const KIND_ICON: Record<ActivityKind, typeof StickyNote> = {
  NOTE: StickyNote, CALL: Phone, EMAIL: Mail, MEETING: Users, SITE_VISIT: Footprints, TASK: CalendarClock, STAGE: ArrowRightLeft,
};
const PLACEHOLDER: Record<Exclude<ActivityKind, "STAGE">, string> = {
  NOTE: "Write a note for the team…", CALL: "How did the call go?", EMAIL: "What was the email about?", MEETING: "Who was there, what was decided?",
  SITE_VISIT: "What did you find on site? Rooms, power, rigging, sightlines…", TASK: "What needs doing? e.g. Send the revised proposal",
};

/** yyyy-mm-dd in local time. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** A picked day → 9am local, as an instant. */
export const dayToIso = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, 9).toISOString(); };
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return ymd(d); };

export function dueInfo(iso: string): { label: string; tone: "bad" | "warn" | "muted" } {
  const due = new Date(iso), today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(due).setHours(0, 0, 0, 0) - today.getTime()) / 86_400_000);
  if (days < 0) return { label: days === -1 ? "Yesterday" : `${-days} days overdue`, tone: "bad" };
  if (days === 0) return { label: "Today", tone: "warn" };
  if (days === 1) return { label: "Tomorrow", tone: "muted" };
  return { label: due.toLocaleDateString("en-US", { weekday: days < 7 ? "long" : undefined, month: days < 7 ? undefined : "short", day: days < 7 ? undefined : "numeric" }), tone: "muted" };
}
const when = (d: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

type Target = { leadId: string } | { customerId: string } | { jobId: string };
const query = (t: Target) => ("leadId" in t ? `lead=${t.leadId}` : "jobId" in t ? `job=${t.jobId}` : `client=${t.customerId}`);

export function ActivityFeed({ target, people, title = "Activity", eyebrow = "Notes & follow-ups", showContext = false, compact = false }: {
  target: Target; people?: Ref[]; title?: string; eyebrow?: string;
  /** On a client, say which lead or job each entry is about. */
  showContext?: boolean; compact?: boolean;
}) {
  const d = useOps<Activity[]>(`/activities?${query(target)}`);
  const rows = d.data ?? [];
  const open = rows.filter((a) => a.dueAt && !a.doneAt).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  const rest = rows.filter((a) => !(a.dueAt && !a.doneAt));
  return (
    <Card eyebrow={eyebrow} title={title}>
      <Composer target={target} people={people} />
      {!d.data ? <Loading /> : (
        <>
          {open.length > 0 && (
            <div className="border-t border-line">
              <div className="label px-4 pb-1 pt-3">To do</div>
              <ul>{open.map((a) => <FollowUpRow key={a.id} a={a} showContext={showContext} />)}</ul>
            </div>
          )}
          {rest.length ? (
            <ul className={clsx("border-t border-line px-4 py-2", compact && "max-h-[460px] overflow-y-auto")}>
              {rest.map((a) => <Entry key={a.id} a={a} showContext={showContext} />)}
            </ul>
          ) : !open.length && <Empty>Nothing yet. Log a call, a note or a site visit, or set a follow-up.</Empty>}
        </>
      )}
    </Card>
  );
}

function Composer({ target, people }: { target: Target; people?: Ref[] }) {
  const me = useOpsUser();
  const refresh = useOpsRefresh();
  const [kind, setKind] = useState<Exclude<ActivityKind, "STAGE">>("NOTE");
  const [body, setBody] = useState("");
  const [follow, setFollow] = useState(false);
  const [day, setDay] = useState(plusDays(2));
  const [next, setNext] = useState("");
  const [who, setWho] = useState(me.user.id);
  const [busy, setBusy] = useState(false);
  const task = kind === "TASK";
  const save = async () => {
    setBusy(true);
    try {
      if (task) await ops("/activities", { json: { ...target, kind, body: body.trim(), dueAt: dayToIso(day), assignedToId: who } });
      else {
        await ops("/activities", { json: { ...target, kind, body: body.trim() } });
        if (follow) await ops("/activities", { json: { ...target, kind: "TASK", body: next.trim() || "Follow up", dueAt: dayToIso(day), assignedToId: who } });
      }
      setBody(""); setNext(""); setFollow(false);
      toast.success(task ? "Follow-up set" : follow ? "Saved, with a follow-up" : "Saved");
      await refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const dateRow = (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" className="input w-auto py-1.5 text-xs" value={day} min={plusDays(-365)} onChange={(e) => setDay(e.target.value)} />
      {[["Tomorrow", plusDays(1)], ["In 3 days", plusDays(3)], ["Next week", nextMonday()]].map(([l, v]) => (
        <button key={l} type="button" onClick={() => setDay(v)} className={clsx("rounded-full border px-2.5 py-1 text-[11px]", day === v ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-soft hover:bg-hover")}>{l}</button>
      ))}
      {people && people.length > 1 && (
        <select className="input w-auto py-1.5 text-xs" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Who">
          {people.map((p) => <option key={p.id} value={p.id}>{p.id === me.user.id ? "Me" : p.name}</option>)}
        </select>
      )}
    </div>
  );
  return (
    <form className="space-y-2.5 p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="flex flex-wrap gap-1">
        {ACTIVITY_KINDS.map((k) => {
          const Icon = KIND_ICON[k.id];
          return (
            <button key={k.id} type="button" onClick={() => setKind(k.id)}
              className={clsx("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition", kind === k.id ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-hover")}>
              <Icon size={13} />{k.label}
            </button>
          );
        })}
      </div>
      <textarea rows={task ? 1 : 2} className="input resize-y" placeholder={PLACEHOLDER[kind]} value={body} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }} />
      {task ? dateRow : follow ? (
        <div className="space-y-2 rounded-lg border border-line bg-hover/30 p-2.5">
          <input className="input py-1.5 text-xs" placeholder="What's next? (Follow up)" value={next} onChange={(e) => setNext(e.target.value)} />
          {dateRow}
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy || (!body.trim() && kind === "NOTE")}>{busy && <Spinner />}{task ? "Set follow-up" : "Save"}</button>
        {!task && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
            <input type="checkbox" className="accent-[rgb(var(--c-accent))]" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Add a follow-up
          </label>
        )}
      </div>
    </form>
  );
}

function Context({ a }: { a: Activity }) {
  if (a.lead) return <Link href={`/avl/leads/view?id=${a.lead.id}`} className="text-accent hover:underline">{a.lead.title}</Link>;
  if (a.job) return <Link href={`/avl/jobs/view?id=${a.job.id}`} className="text-accent hover:underline">{a.job.number} · {a.job.name}</Link>;
  if (a.customer) return <Link href={`/avl/clients/view?id=${a.customer.id}`} className="text-accent hover:underline">{a.customer.name}</Link>;
  return null;
}

function useActions(a: Activity) {
  const me = useOpsUser();
  const refresh = useOpsRefresh();
  const mine = a.createdBy?.id === me.user.id || me.nav.avlManager;
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast.success(msg); await refresh(); } catch (e) { toast.error((e as Error).message); } };
  return {
    mine,
    toggle: (done: boolean) => run(() => ops(`/activities/${a.id}`, { method: "PUT", json: { done } }), done ? "Done" : undefined),
    remove: () => confirm("Delete this?") && run(() => ops(`/activities/${a.id}`, { method: "DELETE" }), "Deleted"),
  };
}

export function FollowUpRow({ a, showContext }: { a: Activity; showContext?: boolean }) {
  const me = useOpsUser();
  const { toggle, remove, mine } = useActions(a);
  const due = dueInfo(a.dueAt!);
  return (
    <li className="group flex items-start gap-3 px-4 py-2">
      <button onClick={() => toggle(true)} title="Mark done" className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border border-line-strong text-transparent transition hover:border-ok hover:text-ok">
        <Check size={12} strokeWidth={3} />
      </button>
      <div className="min-w-0 flex-1 text-sm">
        <div className="whitespace-pre-wrap break-words">{a.body || "Follow up"}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-ink-faint">
          <span className={clsx("font-medium", due.tone === "bad" ? "text-bad" : due.tone === "warn" ? "text-warn" : "text-ink-muted")}>{due.label}</span>
          {a.assignedTo && a.assignedTo.id !== me.user.id && <span>· {a.assignedTo.name}</span>}
          {showContext && (a.lead || a.job || a.customer) && <span>· <Context a={a} /></span>}
        </div>
      </div>
      {mine && <button onClick={remove} title="Delete" className="btn-ghost p-1 text-ink-faint opacity-0 transition group-hover:opacity-100"><Trash2 size={12} /></button>}
    </li>
  );
}

function Entry({ a, showContext }: { a: Activity; showContext?: boolean }) {
  const { toggle, remove, mine } = useActions(a);
  const Icon = KIND_ICON[a.kind];
  if (a.kind === "STAGE") {
    return (
      <li className="flex items-center gap-2 py-1.5 pl-1 text-[11px] text-ink-faint">
        <Icon size={11} /><span className="min-w-0 flex-1 truncate">{a.body}{a.createdBy ? ` · ${a.createdBy.name}` : ""}</span><span className="shrink-0">{when(a.createdAt)}</span>
      </li>
    );
  }
  const verb = ACTIVITY_KINDS.find((k) => k.id === a.kind)?.label ?? "";
  return (
    <li className="group relative flex gap-3 py-2.5">
      <span className={clsx("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", a.kind === "TASK" ? "bg-ok-soft text-ok" : "bg-hover text-ink-soft")}>
        {a.kind === "TASK" ? <Check size={13} /> : <Icon size={13} />}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-ink-faint">
          <span className="font-medium text-ink-soft">{a.createdBy?.name ?? "Someone"}</span>
          <span>{a.kind === "TASK" ? "follow-up done" : verb.toLowerCase()}</span>
          {showContext && (a.lead || a.job || a.customer) && <span>· <Context a={a} /></span>}
          <span className="ml-auto">{when(a.createdAt)}</span>
        </div>
        {a.body && <div className={clsx("mt-0.5 whitespace-pre-wrap break-words", a.kind === "TASK" && "text-ink-muted line-through decoration-ink-faint")}>{a.body}</div>}
      </div>
      <div className="absolute right-0 top-6 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
        {a.kind === "TASK" && <button onClick={() => toggle(false)} title="Not done" className="btn-ghost p-1 text-[11px] text-ink-faint">Undo</button>}
        {mine && <button onClick={remove} title="Delete" className="btn-ghost p-1 text-ink-faint"><Trash2 size={12} /></button>}
      </div>
    </li>
  );
}
