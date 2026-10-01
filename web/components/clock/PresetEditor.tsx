"use client";
/** Editing a saved timer (preset): its main and second timer, message, colors, what comes next, schedule. */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { CLOCK_MODES, DEFAULT_LABEL, DEFAULT_TIMER_COLOR, TIMER_COLORS, hms, type ClockMode, type ClockPreset, type ClockTimerSpec } from "@shared/clock";
import { Api } from "@/lib/api";
import { Modal, Spinner } from "@/components/ui";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const COLORS = ["#60A5FA", "#34D399", "#F59E0B", "#F472B6", "#A78BFA", "#22D3EE", "#FB7185", "#A3E635"];

const to12 = (hhmm?: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
};

export function describeSpec(s: ClockTimerSpec): string {
  switch (s.mode) {
    case "countdown": return `${hms(s.durationSec ?? 0)} countdown`;
    case "countup": return "Count up";
    case "totime": return `Until ${to12(s.target) || "a time"}`;
    case "timeofday": return "Time of day";
    case "service": return "Until service";
    case "liveitem": return "Live item";
  }
}

/** "5:00" / "1:30:00" / "90" (minutes) → seconds. */
export function parseDuration(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const parts = t.split(":").map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 1) return Math.round(parts[0] * 60);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/** The fields for one timer (mode-specific). */
export function SpecFields({ spec, onChange, compact }: { spec: ClockTimerSpec; onChange: (s: ClockTimerSpec) => void; compact?: boolean }) {
  const types = useQuery({ queryKey: ["serviceTypes"], queryFn: Api.serviceTypes, staleTime: 10 * 60_000, enabled: spec.mode === "service" || spec.mode === "liveitem" });
  const [dur, setDur] = useState(hms(spec.durationSec ?? 300));
  return (
    <div className={clsx("grid gap-3", compact ? "grid-cols-2" : "sm:grid-cols-3")}>
      {spec.mode === "countdown" && (
        <label className="block"><span className="label block">Length</span>
          <input className="input mt-1 font-mono" value={dur} placeholder="5:00" onChange={(e) => setDur(e.target.value)}
            onBlur={() => { const s = parseDuration(dur); if (s != null) { onChange({ ...spec, durationSec: s }); setDur(hms(s)); } else setDur(hms(spec.durationSec ?? 300)); }} />
        </label>
      )}
      {spec.mode === "totime" && (
        <label className="block"><span className="label block">Count down to</span>
          <input type="time" className="input mt-1" value={spec.target ?? ""} onChange={(e) => onChange({ ...spec, target: e.target.value })} />
        </label>
      )}
      {(spec.mode === "service" || spec.mode === "liveitem") && (
        <label className="block"><span className="label block">Service type</span>
          <select className="input mt-1" value={spec.serviceTypeId ?? ""} onChange={(e) => onChange({ ...spec, serviceTypeId: e.target.value || null })}>
            <option value="">{spec.mode === "service" ? "The next service of any type" : "Whichever is live"}</option>
            {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}
      <label className="block"><span className="label block">Label</span>
        <input className="input mt-1" value={spec.label ?? ""} placeholder={spec.mode === "liveitem" ? "The item’s title" : DEFAULT_LABEL[spec.mode]} maxLength={60}
          onChange={(e) => onChange({ ...spec, label: e.target.value })} />
      </label>
      {spec.mode !== "timeofday" && spec.mode !== "countup" && (
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-soft">
          <input type="checkbox" checked={spec.overtime ?? true} onChange={(e) => onChange({ ...spec, overtime: e.target.checked })} />
          Keep counting past zero
        </label>
      )}
    </div>
  );
}

function ModePicker({ mode, onChange, allowNone }: { mode: ClockMode | null; onChange: (m: ClockMode | null) => void; allowNone?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {allowNone && <button onClick={() => onChange(null)} className={clsx("rounded-md px-2.5 py-1 text-xs", mode === null ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-hover")}>None</button>}
      {CLOCK_MODES.map((m) => (
        <button key={m.mode} title={m.hint} onClick={() => onChange(m.mode)}
          className={clsx("rounded-md px-2.5 py-1 text-xs", mode === m.mode ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-hover")}>{m.label}</button>
      ))}
    </div>
  );
}

export function PresetEditor({ preset, presets, isNew, busy, onSave, onDelete, onClose, onTry }: {
  preset: ClockPreset; presets: ClockPreset[]; isNew: boolean; busy: boolean;
  onSave: (p: ClockPreset) => void; onDelete: () => void; onClose: () => void; onTry: (p: ClockPreset) => void;
}) {
  const [p, setP] = useState<ClockPreset>(preset);
  const set = (patch: Partial<ClockPreset>) => setP({ ...p, ...patch });
  const sched = p.schedule ?? { enabled: false, days: [0], time: "08:55" };
  return (
    <Modal open onClose={onClose} width={720} title={isNew ? "New timer" : `Edit · ${preset.name}`}>
      <div className="max-h-[72vh] space-y-5 overflow-y-auto p-5">
        <div className="flex items-end gap-3">
          <label className="block flex-1"><span className="label block">Name</span>
            <input className="input mt-1" value={p.name} maxLength={60} autoFocus onChange={(e) => set({ name: e.target.value })} placeholder="Walk-in" />
          </label>
          <div className="flex gap-1 pb-1.5">
            {COLORS.map((c) => <button key={c} aria-label={c} onClick={() => set({ color: c })} className={clsx("h-6 w-6 rounded-full ring-offset-2 ring-offset-surface", p.color === c && "ring-2 ring-ink")} style={{ background: c }} />)}
          </div>
        </div>

        <section>
          <h3 className="label mb-2">Main timer</h3>
          <ModePicker mode={p.main.mode} onChange={(m) => m && set({ main: { ...p.main, mode: m } })} />
          <div className="mt-3"><SpecFields key={`m-${p.main.mode}`} spec={p.main} onChange={(main) => set({ main })} /></div>
        </section>

        <section>
          <h3 className="label mb-2">Second timer <span className="normal-case tracking-normal text-ink-faint">(smaller, under the main one)</span></h3>
          <ModePicker allowNone mode={p.secondary?.mode ?? null} onChange={(m) => set({ secondary: m ? { ...(p.secondary ?? {}), mode: m } : null })} />
          {p.secondary && (
            <div className="mt-3 space-y-2">
              <SpecFields key={`s-${p.secondary.mode}`} spec={p.secondary} onChange={(s) => set({ secondary: { ...p.secondary, ...s } })} />
              {(p.secondary.mode === "countup" || p.secondary.mode === "countdown") && (
                <label className="flex items-center gap-2 text-sm text-ink-soft">
                  <input type="checkbox" checked={Boolean(p.secondary.startWhenMainEnds)} onChange={(e) => set({ secondary: { ...p.secondary!, startWhenMainEnds: e.target.checked } })} />
                  Start it when the main timer reaches zero
                </label>
              )}
            </div>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label block">Information title</span>
            <input className="input mt-1" value={p.info?.title ?? ""} maxLength={60} placeholder="e.g. ALPHA (empty: the timer’s label)" onChange={(e) => set({ info: { title: e.target.value, subtitle: p.info?.subtitle ?? "" } })} />
          </label>
          <label className="block"><span className="label block">Information subtitle</span>
            <input className="input mt-1" value={p.info?.subtitle ?? ""} maxLength={80} placeholder="e.g. Session 1 (empty: this timer’s name)" onChange={(e) => set({ info: { title: p.info?.title ?? "", subtitle: e.target.value } })} />
          </label>
          <div className="sm:col-span-2">
            <span className="label block">Timer color</span>
            <div className="mt-1 flex gap-1.5">
              {TIMER_COLORS.map((c) => (
                <button key={c.color} title={c.name} aria-label={c.name} onClick={() => set({ timerColor: c.color })}
                  className={clsx("h-7 w-7 rounded-md border border-line ring-offset-2 ring-offset-surface", (p.timerColor ?? DEFAULT_TIMER_COLOR).toUpperCase() === c.color && "ring-2 ring-accent")} style={{ background: c.color }} />
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-3"><span className="label block">Message</span>
            <input className="input mt-1" value={p.message} maxLength={200} onChange={(e) => set({ message: e.target.value })} placeholder="Optional, shows under the clock" />
          </label>
          <label className="block"><span className="label block">Yellow at</span>
            <input className="input mt-1 font-mono" defaultValue={hms(p.warnSec)} onBlur={(e) => set({ warnSec: parseDuration(e.target.value) ?? p.warnSec })} />
          </label>
          <label className="block"><span className="label block">Red at</span>
            <input className="input mt-1 font-mono" defaultValue={hms(p.dangerSec)} onBlur={(e) => set({ dangerSec: parseDuration(e.target.value) ?? p.dangerSec })} />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-soft">
            <input type="checkbox" checked={p.autoStart} onChange={(e) => set({ autoStart: e.target.checked })} /> Start when loaded
          </label>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label block">When it reaches zero, start</span>
            <select className="input mt-1" value={p.nextPresetId ?? ""} onChange={(e) => set({ nextPresetId: e.target.value || null })}>
              <option value="">Nothing (stay on this timer)</option>
              {presets.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <div>
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={sched.enabled} onChange={(e) => set({ schedule: { ...sched, enabled: e.target.checked } })} /> Start automatically
            </label>
            <div className={clsx("mt-2 flex flex-wrap items-center gap-1", !sched.enabled && "pointer-events-none opacity-40")}>
              {DAYS.map((d, i) => (
                <button key={d} onClick={() => set({ schedule: { ...sched, days: sched.days.includes(i) ? sched.days.filter((x) => x !== i) : [...sched.days, i].sort() } })}
                  className={clsx("rounded-md px-1.5 py-0.5 text-xs", sched.days.includes(i) ? "bg-accent text-white" : "bg-hover text-ink-muted")}>{d}</button>
              ))}
              <input type="time" className="input ml-1 w-36 py-1 text-sm" value={sched.time} onChange={(e) => set({ schedule: { ...sched, time: e.target.value } })} />
            </div>
          </div>
        </section>
      </div>
      <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
        {!isNew && <button className="btn-ghost text-sm hover:text-bad" onClick={() => { if (confirm(`Delete “${preset.name}”?`)) onDelete(); }}><Trash2 size={14} /> Delete</button>}
        <button className="btn-ghost text-sm" onClick={() => onTry(p)} title="Put this on the clock now (without saving)"><Play size={14} /> Try it</button>
        <button className="btn-ghost ml-auto" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !p.name.trim()} onClick={() => onSave({ ...p, name: p.name.trim(), schedule: p.schedule ?? (sched.enabled ? sched : null) })}>{busy && <Spinner />} Save</button>
      </footer>
    </Modal>
  );
}
