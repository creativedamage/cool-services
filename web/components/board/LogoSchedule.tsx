"use client";
/**
 * Logos over the mic board's clock: the library (with the default), and a calendar for when each
 * one shows. Click a day to put a logo on it, once or repeating (every day, chosen weekdays, monthly,
 * yearly), all day or between two times, until a date or for good. The display picks the logo for
 * right now (shared/board.ts → activeLogo).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Star, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { describeRule, occursOn, weekday, ymd, type BoardSettings, type LogoRule } from "@shared/board";
import { Api } from "@/lib/api";
import { Modal } from "@/components/ui";

const imgUrl = (id: string) => `/api/board-out/image/${encodeURIComponent(id)}`;
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const failed = (what: string) => (e: unknown) => toast.error(`Couldn’t ${what}`, { description: (e as Error).message });

function useSet() {
  const qc = useQueryClient();
  return (settings: BoardSettings) => { qc.setQueryData(["stageDisplay"], (v: any) => v && { ...v, settings }); void qc.invalidateQueries({ queryKey: ["stageDisplay"] }); };
}

function Thumb({ id, className }: { id: string | null | undefined; className?: string }) {
  return (
    <span className={clsx("flex items-center justify-center overflow-hidden rounded bg-[#0E0E0F]", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {id && <img src={imgUrl(id)} alt="" className="max-h-full max-w-full object-contain p-0.5" />}
    </span>
  );
}

/** In Display settings: your logos, which one is the default, and the way into the schedule. */
export function LogosPanel({ s, shrink }: { s: BoardSettings; shrink: (f: File) => Promise<string> }) {
  const set = useSet();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = async (list: FileList) => {
    setBusy(true);
    for (const f of [...list]) {
      try { set(await Api.addBoardLogo(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim(), await shrink(f))); } catch (e) { failed(`add ${f.name}`)(e); }
    }
    setBusy(false);
  };
  const def = useMutation({ mutationFn: Api.defaultBoardLogo, onSuccess: set, onError: failed("set the default") });
  const remove = useMutation({ mutationFn: Api.removeBoardLogo, onSuccess: set, onError: failed("remove it") });
  const rename = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => Api.renameBoardLogo(id, name), onSuccess: set, onError: failed("rename it") });
  const scheduled = s.logoSchedule.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-muted">Logos</span>
        <div className="flex gap-1.5">
          {s.logos.length > 0 && <button className="btn-outline py-1 text-xs" onClick={() => setOpen(true)}><CalendarDays size={13} /> Schedule{scheduled ? ` (${scheduled})` : ""}</button>}
          <label className={clsx("btn-outline cursor-pointer py-1 text-xs", busy && "pointer-events-none opacity-60")}><Upload size={13} /> {busy ? "Adding…" : "Add logo"}
            <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => { if (e.target.files?.length) void add(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      </div>
      {s.logos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-ink-muted">No logo yet. A PNG with a see-through background looks best on the dark board.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {s.logos.map((l) => {
            const isDef = s.center.logoId === l.id;
            return (
              <div key={l.id} className={clsx("group relative overflow-hidden rounded-lg border", isDef ? "border-accent" : "border-line")}>
                <Thumb id={l.id} className="h-16 w-full rounded-none" />
                <button className={clsx("absolute left-1 top-1 rounded-md p-1", isDef ? "bg-accent text-white" : "bg-black/60 text-white opacity-0 group-hover:opacity-100")}
                  title={isDef ? "The default: shows whenever nothing is scheduled" : "Make this the default"} onClick={() => def.mutate(isDef ? null : l.id)}><Star size={11} /></button>
                <button className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100" title="Remove (and from the schedule)"
                  onClick={() => { if (window.confirm(`Remove “${l.name}” from your logos and its schedule on every Mac?`)) remove.mutate(l.id); }}><Trash2 size={11} /></button>
                <input className="w-full bg-transparent px-1.5 py-1 text-[11px] outline-none focus:bg-surface" defaultValue={l.name} maxLength={80}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) rename.mutate({ id: l.id, name: v }); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
              </div>
            );
          })}
        </div>
      )}
      {s.logos.length > 0 && (
        <p className="text-[11px] text-ink-faint">
          The starred logo shows whenever nothing’s scheduled{s.center.logoId ? "" : " (none starred: no logo)"}. Use Schedule to swap in others on chosen days: a holiday, a series, a youth night.
        </p>
      )}
      {open && <LogoScheduleModal s={s} onClose={() => setOpen(false)} />}
    </div>
  );
}

const newRule = (date: string, logoId: string): LogoRule => ({ id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, logoId, date, repeat: "none", days: [], until: null, from: null, to: null });

/** The month calendar, with the rule editor (or the list of rules) beside it. */
function LogoScheduleModal({ s, onClose }: { s: BoardSettings; onClose: () => void }) {
  const set = useSet();
  const today = ymd(new Date());
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [edit, setEdit] = useState<LogoRule | null>(null);
  const save = useMutation({ mutationFn: Api.saveLogoSchedule, onSuccess: (v) => { set(v); setEdit(null); }, onError: failed("save the schedule") });
  const rules = s.logoSchedule;
  const name = (id: string | null) => s.logos.find((l) => l.id === id)?.name ?? "No logo";

  // Six weeks from the Sunday on or before the 1st.
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);

  /** What a day shows: the all-day logo (scheduled or default) and any timed ones. */
  const dayInfo = (day: string) => {
    const on = rules.filter((r) => s.logos.some((l) => l.id === r.logoId) && occursOn(r, day));
    const allDay = on.filter((r) => !r.from).at(-1) ?? null;
    return { allDay, timed: on.filter((r) => r.from) };
  };

  const put = (r: LogoRule) => save.mutate(rules.some((x) => x.id === r.id) ? rules.map((x) => (x.id === r.id ? r : x)) : [...rules, r]);
  const del = (id: string) => save.mutate(rules.filter((x) => x.id !== id));
  const fmtT = (t: string) => { const [h, m] = t.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: m ? "2-digit" : undefined }).replace(" ", "").toLowerCase(); };

  return (
    <Modal open onClose={onClose} title="Logo schedule" width={1180}>
      <div className="flex max-h-[80vh] min-h-[560px]">
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center gap-2">
            <button className="btn-ghost p-1.5" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
            <button className="btn-ghost p-1.5" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
            <h3 className="text-lg font-semibold">{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3>
            <button className="btn-outline ml-auto py-1 text-xs" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
          </div>
          <div className="grid grid-cols-7 border-l border-t border-line text-xs">
            {WEEK.map((w) => <div key={w} className="border-b border-r border-line bg-hover/50 px-2 py-1.5 font-medium text-ink-muted">{w}</div>)}
            {cells.map((d) => {
              const day = ymd(d);
              const inMonth = d.getMonth() === month.getMonth();
              const { allDay, timed } = dayInfo(day);
              const logo = allDay ? allDay.logoId : s.center.logoId;
              return (
                <button key={day} onClick={() => setEdit(newRule(day, s.center.logoId && s.logos.length > 1 ? (s.logos.find((l) => l.id !== s.center.logoId)?.id ?? s.logos[0].id) : s.logos[0].id))}
                  className={clsx("group relative flex h-[92px] flex-col border-b border-r border-line p-1.5 text-left transition hover:bg-hover", !inMonth && "bg-black/20 opacity-50", edit?.date === day && "ring-2 ring-inset ring-accent")}>
                  <span className={clsx("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", day === today ? "bg-accent font-semibold text-white" : "text-ink-soft")}>{d.getDate()}</span>
                  <Thumb id={logo} className={clsx("mt-1 h-9 w-full", !allDay && "opacity-35")} />
                  <div className="mt-auto flex flex-wrap gap-1">
                    {timed.slice(0, 2).map((r) => (
                      <span key={r.id} className="flex items-center gap-1 rounded bg-accent/15 px-1 text-[10px] text-accent" title={`${name(r.logoId)} · ${describeRule(r)}`}>
                        {fmtT(r.from!)}
                      </span>
                    ))}
                    {timed.length > 2 && <span className="text-[10px] text-ink-faint">+{timed.length - 2}</span>}
                  </div>
                  <Plus size={12} className="absolute right-1.5 top-1.5 text-ink-faint opacity-0 group-hover:opacity-100" />
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-ink-faint">Each day shows the logo that’s on it all day (faded: the default). Times show the logos that swap in for part of the day. Click a day to schedule a logo on it.</p>
        </div>

        <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-line p-4">
          {edit ? (
            <RuleEditor s={s} rule={edit} existing={rules.some((r) => r.id === edit.id)} busy={save.isPending}
              onSave={put} onDelete={() => del(edit.id)} onCancel={() => setEdit(null)} />
          ) : (
            <div className="space-y-3">
              <h4 className="font-semibold">Scheduled</h4>
              <div className="flex items-center gap-2 rounded-lg border border-line p-2 text-sm">
                <Thumb id={s.center.logoId} className="h-8 w-14 shrink-0" />
                <div className="min-w-0"><div className="truncate">{name(s.center.logoId)}</div><div className="text-[11px] text-ink-faint">Default, whenever nothing’s scheduled</div></div>
              </div>
              {rules.length === 0 && <p className="text-xs text-ink-muted">Nothing scheduled yet. Click a day on the calendar.</p>}
              {[...rules].reverse().map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-lg border border-line p-2 text-sm">
                  <Thumb id={r.logoId} className="h-8 w-14 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{name(r.logoId)}</div>
                    <div className="text-[11px] text-ink-faint">{describeRule(r)}</div>
                  </div>
                  <button className="btn-ghost p-1" title="Change" onClick={() => { setEdit(r); const [y, m] = r.date.split("-").map(Number); setMonth(new Date(y, m - 1, 1)); }}><Pencil size={13} /></button>
                  <button className="btn-ghost p-1 text-ink-muted hover:text-bad" title="Remove" onClick={() => del(r.id)}><Trash2 size={13} /></button>
                </div>
              ))}
              {rules.length > 1 && <p className="text-[11px] text-ink-faint">When two land on the same time, the one with set times wins over an all-day one, then the one higher in this list.</p>}
            </div>
          )}
        </aside>
      </div>
    </Modal>
  );
}

function RuleEditor({ s, rule, existing, busy, onSave, onDelete, onCancel }: {
  s: BoardSettings; rule: LogoRule; existing: boolean; busy: boolean; onSave: (r: LogoRule) => void; onDelete: () => void; onCancel: () => void;
}) {
  const [r, setR] = useState(rule);
  const up = (p: Partial<LogoRule>) => setR({ ...r, ...p });
  const [y, m, d] = r.date.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dow = weekday(r.date);
  const days = r.days.length ? r.days : [dow];
  const timed = Boolean(r.from && r.to);
  const bad = (r.until && r.until < r.date) ? "It can’t end before it starts." : timed && r.from === r.to ? "Pick two different times." : null;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h4 className="font-semibold">{existing ? "Change" : "Schedule a logo"}</h4>
        <p className="text-xs text-ink-muted">{date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
      </div>
      <div>
        <span className="text-xs text-ink-muted">Logo</span>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          {s.logos.map((l) => (
            <button key={l.id} onClick={() => up({ logoId: l.id })} title={l.name}
              className={clsx("overflow-hidden rounded-lg border-2", r.logoId === l.id ? "border-accent" : "border-transparent hover:border-line")}>
              <Thumb id={l.id} className="h-12 w-full rounded-none" />
              <span className="block truncate px-1 py-0.5 text-[10px] text-ink-soft">{l.name}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="block"><span className="text-xs text-ink-muted">Starts</span>
        <input type="date" className="input mt-1" value={r.date} onChange={(e) => e.target.value && up({ date: e.target.value, days: [] })} />
      </label>
      <label className="block"><span className="text-xs text-ink-muted">Repeats</span>
        <select className="input mt-1" value={r.repeat} onChange={(e) => up({ repeat: e.target.value as LogoRule["repeat"], days: e.target.value === "weekly" ? [dow] : [] })}>
          <option value="none">Doesn’t repeat</option>
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month on the {d}{d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}</option>
          <option value="yearly">Every year on {date.toLocaleDateString("en-US", { month: "long", day: "numeric" })}</option>
        </select>
      </label>
      {r.repeat === "weekly" && (
        <div className="flex gap-1">
          {WEEK.map((w, i) => (
            <button key={w} onClick={() => { const next = days.includes(i) ? days.filter((x) => x !== i) : [...days, i]; if (next.length) up({ days: next.sort() }); }}
              className={clsx("flex-1 rounded-md border py-1 text-[11px]", days.includes(i) ? "border-accent bg-accent text-white" : "border-line text-ink-soft hover:bg-hover")}>{w[0]}</button>
          ))}
        </div>
      )}
      {r.repeat !== "none" && (
        <label className="block"><span className="text-xs text-ink-muted">Ends</span>
          <div className="mt-1 flex items-center gap-2">
            <select className="input w-28" value={r.until ? "on" : "never"} onChange={(e) => up({ until: e.target.value === "on" ? r.date : null })}>
              <option value="never">Never</option><option value="on">On</option>
            </select>
            {r.until && <input type="date" className="input flex-1" value={r.until} min={r.date} onChange={(e) => up({ until: e.target.value || null })} />}
          </div>
        </label>
      )}
      <div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!timed} onChange={(e) => up(e.target.checked ? { from: null, to: null } : { from: "18:00", to: "21:00" })} /> All day</label>
        {timed && (
          <div className="mt-2 flex items-center gap-2">
            <input type="time" className="input flex-1" value={r.from!} onChange={(e) => e.target.value && up({ from: e.target.value })} />
            <span className="text-ink-muted">to</span>
            <input type="time" className="input flex-1" value={r.to!} onChange={(e) => e.target.value && up({ to: e.target.value })} />
          </div>
        )}
      </div>
      <p className="rounded-lg bg-hover px-3 py-2 text-xs text-ink-soft">{describeRule(r)}</p>
      {bad && <p className="text-xs text-bad">{bad}</p>}
      <div className="flex items-center gap-2">
        <button className="btn-primary" disabled={busy || Boolean(bad) || !s.logos.some((l) => l.id === r.logoId)} onClick={() => onSave(r)}>{busy ? "Saving…" : existing ? "Save" : "Schedule it"}</button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        {existing && <button className="btn-ghost ml-auto text-bad" onClick={onDelete}><Trash2 size={13} /> Remove</button>}
      </div>
    </div>
  );
}
