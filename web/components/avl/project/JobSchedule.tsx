"use client";
/** A job's schedule: phases on a Gantt (drag to move, pull the ends to resize), the list to edit them, and the crew. */
import clsx from "clsx";
import { ArrowDown, ArrowUp, CalendarRange, ListPlus, Minus, Plus, Trash2, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { JobPage } from "@shared/ops/jobs";
import { addDays, PHASE_COLORS, PHASE_STATUSES, standardSchedule, toDay, type CrewMember, type Phase, type PhaseColor, type PhaseStatus } from "@shared/ops/projects";
import { ops, useOpsRefresh } from "@/lib/ops";
import { Card } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";
import { fmtRange, Gantt, phaseHex } from "./Gantt";
import { Faces, Initials, PeoplePicker } from "./bits";

const uid = () => `new-${Math.random().toString(36).slice(2, 10)}`;
const LEVEL: Record<string, string> = { CREW: "Crew", TECH: "Tech", MANAGER: "Manager", NONE: "" };

export function JobSchedule({ page, onSaved }: { page: JobPage; onSaved: () => void }) {
  const refresh = useOpsRefresh();
  const canEdit = !page.crewView;
  const [phases, setPhases] = useState<Phase[]>(page.project.phases);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(16);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (!dirty) setPhases(page.project.phases); }, [page.project.phases]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const people = page.assignable;
  const change = (next: Phase[]) => { setPhases(next.map((p, i) => ({ ...p, sortOrder: i }))); setDirty(true); };
  const patch = (id: string, p: Partial<Phase>) => change(phases.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const start = page.job.startDate ?? toDay(new Date());
  const addPhase = () => {
    const last = [...phases].reverse().find((p) => p.endDate);
    const s = last ? addDays(last.endDate!, 1) : start;
    const id = uid();
    change([...phases, { id, name: "New phase", startDate: s, endDate: addDays(s, 2), status: "NOT_STARTED", color: PHASE_COLORS[phases.length % PHASE_COLORS.length], notes: null, people: [], sortOrder: phases.length }]);
    setOpen(id);
  };
  const addStandard = () => {
    const last = [...phases].reverse().find((p) => p.endDate);
    const from = last ? addDays(last.endDate!, 1) : start;
    change([...phases, ...standardSchedule(from).map((p, i) => ({ ...p, id: uid(), sortOrder: phases.length + i }))]);
  };
  const move = (id: string, dir: -1 | 1) => {
    const i = phases.findIndex((p) => p.id === id), j = i + dir;
    if (j < 0 || j >= phases.length) return;
    const next = [...phases]; [next[i], next[j]] = [next[j], next[i]]; change(next);
  };

  // Range: the whole schedule with a little room either side (at least four weeks).
  const range = useMemo(() => {
    const dated = phases.filter((p) => p.startDate);
    const a = dated.length ? dated.map((p) => p.startDate!).sort()[0] : start;
    const b = dated.length ? dated.map((p) => p.endDate ?? p.startDate!).sort().at(-1)! : addDays(start, 21);
    const from = addDays(a, -3);
    const to = addDays(b, 5) < addDays(from, 27) ? addDays(from, 27) : addDays(b, 5);
    return { from, to };
  }, [phases, start]);

  async function save() {
    setSaving(true); setError(null);
    try {
      const out = await ops<Phase[]>(`/jobs/${page.job.id}/phases`, { method: "PUT", json: { phases: phases.map(({ sortOrder: _s, ...p }) => p) } });
      setPhases(out); setDirty(false); toast.success("Schedule saved");
      void refresh(); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  const name = (id: string) => people.find((p) => p.id === id) ?? { id, name: "Someone" };
  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <Card eyebrow="Schedule" title="Phases" action={
        <div className="flex items-center gap-1.5">
          <span className="mr-1 hidden text-[11px] text-ink-faint sm:inline">{canEdit && phases.length ? "Drag a bar to move it; pull its ends to change the dates." : ""}</span>
          <button className="btn-ghost p-1.5" title="Zoom out" onClick={() => setZoom(Math.max(16, zoom - 10))}><Minus size={14} /></button>
          <button className="btn-ghost p-1.5" title="Zoom in" onClick={() => setZoom(Math.min(66, zoom + 10))}><Plus size={14} /></button>
        </div>
      }>
        <Gantt from={range.from} to={range.to} dayWidth={zoom}
          rows={phases.map((p) => ({ id: p.id, label: <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: phaseHex(p.color) }} />{p.name}</span>, sub: <span className="flex items-center gap-2">{PHASE_STATUSES.find((s) => s.id === p.status)?.label}{p.people.length > 0 && <Faces people={p.people.map(name)} max={3} />}</span> }))}
          bars={phases.filter((p) => p.startDate).map((p) => ({ id: p.id, rowId: p.id, start: p.startDate!, end: p.endDate ?? p.startDate!, label: p.name, color: p.color, done: p.status === "DONE" }))}
          onChange={canEdit ? (id, s, e) => patch(id, { startDate: s, endDate: e }) : undefined}
          onBarClick={(id) => setOpen(open === id ? null : id)}
          empty={canEdit ? <span>No phases yet. Start with the standard AVL phases (Design, Order, Pre-wire, Install, Commission, Training) or add your own.</span> : "No schedule yet."} />
        {canEdit && (
          <div className="flex flex-wrap gap-2 border-t border-line p-3">
            <button className="btn-primary py-1.5 text-xs" onClick={addPhase}><Plus size={13} /> Add phase</button>
            <button className="btn-outline py-1.5 text-xs" onClick={addStandard}><ListPlus size={13} /> {phases.length ? "Add the standard phases after these" : "Standard AVL phases"}</button>
          </div>
        )}
      </Card>

      {phases.length > 0 && (
        <Card eyebrow="Phases" title="Dates, status and people">
          <ul className="divide-y divide-line">
            {phases.map((p, i) => (
              <li key={p.id} className={clsx("px-4 py-3", open === p.id && "bg-hover/30")}>
                <div className="grid items-center gap-2 md:grid-cols-[minmax(0,1.4fr)_140px_140px_140px_minmax(0,1fr)_auto]">
                  <div className="flex min-w-0 items-center gap-2">
                    {canEdit ? (
                      <ColorDot value={p.color} onChange={(c) => patch(p.id, { color: c })} />
                    ) : <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: phaseHex(p.color) }} />}
                    {canEdit ? <input className="input py-1 font-medium" value={p.name} onChange={(e) => patch(p.id, { name: e.target.value })} />
                      : <button className="truncate text-left font-medium" onClick={() => setOpen(open === p.id ? null : p.id)}>{p.name}</button>}
                  </div>
                  {canEdit ? (
                    <>
                      <input type="date" className="input py-1" value={p.startDate ?? ""} onChange={(e) => { const s = e.target.value || null; patch(p.id, { startDate: s, endDate: s && p.endDate && p.endDate < s ? s : p.endDate ?? s }); }} aria-label="Starts" />
                      <input type="date" className="input py-1" value={p.endDate ?? ""} min={p.startDate ?? undefined} onChange={(e) => patch(p.id, { endDate: e.target.value || null })} aria-label="Ends" />
                      <select className="input py-1" value={p.status} onChange={(e) => patch(p.id, { status: e.target.value as PhaseStatus })}>{PHASE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
                    </>
                  ) : (
                    <span className="text-sm text-ink-soft md:col-span-3">{fmtRange(p.startDate, p.endDate)} · {PHASE_STATUSES.find((s) => s.id === p.status)?.label}</span>
                  )}
                  <PeoplePicker all={people} value={p.people} disabled={!canEdit} onChange={(ids) => patch(p.id, { people: ids })} label="Who's on it" />
                  {canEdit && (
                    <div className="flex items-center justify-end">
                      <button className="p-1 text-ink-faint hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(p.id, -1)} aria-label="Move up"><ArrowUp size={14} /></button>
                      <button className="p-1 text-ink-faint hover:text-ink disabled:opacity-30" disabled={i === phases.length - 1} onClick={() => move(p.id, 1)} aria-label="Move down"><ArrowDown size={14} /></button>
                      <button className="p-1 text-bad/70 hover:text-bad" onClick={() => change(phases.filter((x) => x.id !== p.id))} aria-label="Remove phase"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
                {(open === p.id || p.notes) && (
                  canEdit ? <textarea rows={2} className="input mt-2 text-sm" placeholder="Notes for this phase (gear that has to be here first, access, who to call…)" value={p.notes ?? ""} onChange={(e) => patch(p.id, { notes: e.target.value || null })} />
                    : p.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{p.notes}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Crew page={page} />

      <div className={clsx("sticky bottom-3 z-30 flex justify-center transition", dirty ? "opacity-100" : "pointer-events-none opacity-0")}>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-lg">
          <span className="mr-1 text-sm text-warn">● Unsaved schedule</span>
          <button className="btn-ghost" onClick={() => { setPhases(page.project.phases); setDirty(false); setError(null); }}>Discard</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving && <Spinner />}Save schedule</button>
        </div>
      </div>
    </div>
  );
}

function ColorDot({ value, onChange }: { value: PhaseColor | null; onChange: (c: PhaseColor) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button type="button" className="block h-4 w-4 rounded-full ring-2 ring-surface ring-offset-1 ring-offset-line" style={{ background: phaseHex(value) }} onClick={() => setOpen(!open)} aria-label="Color" />
      {open && (
        <span className="absolute left-0 top-6 z-40 flex gap-1.5 rounded-lg border border-line bg-surface p-2 shadow-lift" onMouseLeave={() => setOpen(false)}>
          {PHASE_COLORS.map((c) => <button type="button" key={c} className={clsx("h-5 w-5 rounded-full", c === value && "ring-2 ring-ink ring-offset-1 ring-offset-surface")} style={{ background: phaseHex(c) }} onClick={() => { onChange(c); setOpen(false); }} aria-label={c} />)}
        </span>
      )}
    </span>
  );
}

/** The people on the job: they see it (crew see only jobs they're on). */
function Crew({ page }: { page: JobPage }) {
  const refresh = useOpsRefresh();
  const canEdit = !page.crewView;
  const [crew, setCrew] = useState<CrewMember[]>(page.project.crew);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setCrew(page.project.crew), [page.project.crew]);
  const save = async (ids: string[]) => {
    setBusy(true);
    try { setCrew(await ops<CrewMember[]>(`/jobs/${page.job.id}/crew`, { method: "PUT", json: { userIds: ids } })); void refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setAdding(""); }
  };
  const others = page.assignable.filter((p) => !crew.some((c) => c.id === p.id));
  return (
    <Card eyebrow="Crew" title={<span className="flex items-center gap-2">On this job {busy && <Spinner />}</span>} action={canEdit && others.length > 0 ? (
      <div className="flex items-center gap-1.5">
        <select className="input w-48 py-1 text-xs" value={adding} onChange={(e) => { setAdding(e.target.value); if (e.target.value) void save([...crew.map((c) => c.id), e.target.value]); }}>
          <option value="">Add someone…</option>{others.map((p) => <option key={p.id} value={p.id}>{p.name}{LEVEL[p.avlLevel] ? ` (${LEVEL[p.avlLevel]})` : ""}</option>)}
        </select>
        <UserPlus size={14} className="text-ink-faint" />
      </div>
    ) : undefined}>
      {crew.length ? (
        <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          {crew.map((c) => (
            <li key={c.id} className="flex items-center gap-2.5 bg-surface px-4 py-2.5 text-sm">
              <Initials p={c} size={26} />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span><span className="text-[11px] text-ink-faint">{LEVEL[c.avlLevel] || "AVL"}{page.job.managerId === c.id ? " · Project manager" : ""}</span></span>
              {canEdit && <button className="p-1 text-ink-faint hover:text-bad" onClick={() => void save(crew.filter((x) => x.id !== c.id).map((x) => x.id))} aria-label={`Take ${c.name} off the job`}><X size={14} /></button>}
            </li>
          ))}
        </ul>
      ) : <p className="px-4 py-6 text-sm text-ink-faint">Nobody yet. People on a phase or given a task join the crew; AVL Crew only see the jobs they&apos;re on.</p>}
      {canEdit && <p className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[11px] text-ink-faint"><CalendarRange size={12} /> Putting someone on a phase or a task adds them here too.</p>}
    </Card>
  );
}
