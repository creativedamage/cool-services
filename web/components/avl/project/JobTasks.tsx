"use client";
/** Tasks: to-dos per job and phase, with an assignee, a due date and a checklist. */
import clsx from "clsx";
import { CalendarDays, ChevronDown, ChevronRight, ListChecks, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { JobPage } from "@shared/ops/jobs";
import { toDay, type ChecklistItem, type JobTask, type Phase } from "@shared/ops/projects";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Empty, ErrorBox, Field, Loading, Tabs } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";
import { fmtDay, phaseHex } from "./Gantt";
import { Initials, type P } from "./bits";

export function JobTasks({ page }: { page: JobPage }) {
  const d = useOps<JobTask[]>(`/jobs/${page.job.id}/tasks`);
  const [show, setShow] = useState<"open" | "done" | "all">("open");
  const [edit, setEdit] = useState<JobTask | "new" | null>(null);
  const canEdit = !page.crewView;
  const phases = page.project.phases;
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const tasks = d.data.filter((t) => (show === "all" ? true : show === "open" ? !t.doneAt : !!t.doneAt));
  const groups: { phase: Phase | null; tasks: JobTask[] }[] = [
    ...phases.map((p) => ({ phase: p, tasks: tasks.filter((t) => t.phaseId === p.id) })),
    { phase: null, tasks: tasks.filter((t) => !t.phaseId || !phases.some((p) => p.id === t.phaseId)) },
  ].filter((g) => g.tasks.length);
  const open = d.data.filter((t) => !t.doneAt).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={show} onChange={setShow} items={[{ key: "open", label: "To do", count: open }, { key: "done", label: "Done", count: d.data.length - open }, { key: "all", label: "All" }]} />
        {canEdit && <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={14} /> Add task</button>}
      </div>
      {groups.length ? groups.map((g) => (
        <Card key={g.phase?.id ?? "none"} eyebrow={g.phase ? "Phase" : undefined} title={<span className="flex items-center gap-2">{g.phase && <span className="h-2.5 w-2.5 rounded-full" style={{ background: phaseHex(g.phase.color) }} />}{g.phase?.name ?? "Not in a phase"}</span>}>
          <TaskList tasks={g.tasks} onChanged={() => void d.refetch()} onEdit={canEdit ? (t) => setEdit(t) : undefined} />
        </Card>
      )) : (
        <Card><Empty>{show === "done" ? "Nothing finished yet." : d.data.length ? "All done." : canEdit ? "No tasks yet. Add the work to do (and who does it), by phase if you like." : "No tasks on this job yet."}</Empty></Card>
      )}
      {edit && <TaskModal jobId={page.job.id} task={edit === "new" ? null : edit} phases={phases} people={page.assignable} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void d.refetch(); }} />}
    </div>
  );
}

/** Rows of tasks you can tick (and open to tick their checklist). With `showJob`, each says which job it's on. */
export function TaskList({ tasks, onChanged, onEdit, showJob }: { tasks: JobTask[]; onChanged: () => void; onEdit?: (t: JobTask) => void; showJob?: boolean }) {
  const refresh = useOpsRefresh();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, JobTask>>({});
  const today = toDay(new Date());
  const tick = async (t: JobTask, p: { done?: boolean; checklist?: { id: string; done: boolean }[] }) => {
    setBusy(t.id);
    try {
      const out = await ops<JobTask>(`/tasks/${t.id}/tick`, { json: p });
      setLocal((l) => ({ ...l, [t.id]: out }));
      if (p.done !== undefined) { toast.success(p.done ? "Done" : "Back on the list"); onChanged(); void refresh(); }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const del = async (t: JobTask) => {
    if (!window.confirm(`Delete “${t.title}”?`)) return;
    try { await ops(`/tasks/${t.id}`, { method: "DELETE" }); onChanged(); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t0) => {
        const t = local[t0.id] && local[t0.id].doneAt === t0.doneAt ? local[t0.id] : t0;
        const isOpen = open.has(t.id);
        const ticked = t.checklist.filter((c) => c.done).length;
        const late = !t.doneAt && t.dueDate && t.dueDate < today;
        return (
          <li key={t.id} className="group/task">
            <div className="flex items-start gap-3 px-4 py-2.5">
              <button className={clsx("mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 transition", t.doneAt ? "border-ok bg-ok text-white" : "border-line-strong hover:border-ok")}
                disabled={busy === t.id} onClick={() => void tick(t, { done: !t.doneAt })} aria-label={t.doneAt ? "Mark not done" : "Mark done"}>
                {busy === t.id ? <Spinner size={10} /> : t.doneAt ? <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5.2 4 7.2 8 3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg> : null}
              </button>
              <button className="min-w-0 flex-1 text-left" onClick={() => setOpen((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}>
                <span className={clsx("block text-sm font-medium", t.doneAt && "text-ink-muted line-through")}>{t.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">
                  {showJob && t.job && <Link href={`/avl/jobs/view?id=${t.job.id}&tab=tasks`} onClick={(e) => e.stopPropagation()} className="font-medium text-accent hover:underline">{t.job.number} · {t.job.name}</Link>}
                  {t.dueDate && <span className={clsx("flex items-center gap-1", late && "font-semibold text-bad")}><CalendarDays size={11} />{late ? "Overdue · " : ""}{fmtDay(t.dueDate)}</span>}
                  {t.checklist.length > 0 && <span className={clsx("flex items-center gap-1", ticked === t.checklist.length && "text-ok")}><ListChecks size={11} />{ticked}/{t.checklist.length}</span>}
                  {t.doneAt && t.doneBy && <span>Done by {t.doneBy}</span>}
                  {(t.notes || t.checklist.length > 0) && (isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />)}
                </span>
              </button>
              {t.assignee && <Initials p={t.assignee} size={24} />}
              {onEdit && (
                <span className="flex shrink-0 opacity-0 transition group-hover/task:opacity-100 group-focus-within/task:opacity-100">
                  <button className="p-1 text-ink-faint hover:text-ink" onClick={() => onEdit(t)} aria-label="Edit task"><Pencil size={13} /></button>
                  <button className="p-1 text-bad/70 hover:text-bad" onClick={() => void del(t)} aria-label="Delete task"><Trash2 size={13} /></button>
                </span>
              )}
            </div>
            {isOpen && (t.notes || t.checklist.length > 0) && (
              <div className="space-y-2 pb-3 pl-[46px] pr-4">
                {t.notes && <p className="whitespace-pre-wrap text-sm text-ink-soft">{t.notes}</p>}
                {t.checklist.length > 0 && (
                  <ul className="space-y-1">
                    {t.checklist.map((c) => (
                      <li key={c.id}>
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input type="checkbox" className="accent-[rgb(var(--c-ok))]" checked={c.done} disabled={busy === t.id} onChange={(e) => void tick(t, { checklist: [{ id: c.id, done: e.target.checked }] })} />
                          <span className={clsx(c.done && "text-ink-muted line-through")}>{c.text}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TaskModal({ jobId, task, phases, people, onClose, onSaved }: { jobId: string; task: JobTask | null; phases: Phase[]; people: P[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: task?.title ?? "", phaseId: task?.phaseId ?? "", assigneeId: task?.assignee?.id ?? "", dueDate: task?.dueDate ?? "", notes: task?.notes ?? "" });
  const [list, setList] = useState<ChecklistItem[]>(task?.checklist ?? []);
  const [item, setItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const addItem = () => { const t = item.trim(); if (!t) return; setList([...list, { id: "", text: t, done: false }]); setItem(""); };
  return (
    <Modal open onClose={onClose} title={task ? "Edit task" : "New task"} width={560}>
      <form className="space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        const pending = item.trim() ? [...list, { id: "", text: item.trim(), done: false }] : list;
        try {
          await ops(task ? `/tasks/${task.id}` : `/jobs/${jobId}/tasks`, { method: task ? "PUT" : "POST", json: { ...f, checklist: pending.map((c) => ({ ...c, id: c.id || undefined })) } });
          toast.success(task ? "Task saved" : "Task added"); onSaved();
        } catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <Field label="Task"><input required autoFocus className="input" value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Terminate speaker lines at the amp rack" /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Phase"><select className="input" value={f.phaseId} onChange={(e) => set({ phaseId: e.target.value })}><option value="">None</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Who"><select className="input" value={f.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })}><option value="">Anyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Due"><input type="date" className="input" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><textarea rows={3} className="input" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <div>
          <span className="label mb-1.5 block">Checklist</span>
          <ul className="space-y-1">
            {list.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <input type="checkbox" checked={c.done} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
                <input className="input flex-1 py-1" value={c.text} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                <button type="button" className="p-1 text-ink-faint hover:text-bad" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="Remove"><X size={14} /></button>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex gap-2">
            <input className="input flex-1 py-1" value={item} placeholder="Add a step and press Enter" onChange={(e) => setItem(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} />
            <button type="button" className="btn-outline py-1 text-xs" onClick={addItem}><Plus size={13} /> Add</button>
          </div>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy && <Spinner />}{task ? "Save" : "Add task"}</button>
        </div>
      </form>
    </Modal>
  );
}
