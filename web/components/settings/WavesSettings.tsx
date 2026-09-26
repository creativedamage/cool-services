"use client";
/** Settings → Waves SuperRack: MIDI output, channel, and which snapshot each key recalls. */
import clsx from "clsx";
import { AudioLines, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KEY_ROOTS, type WavesSettings as W } from "@shared/types";
import { sendKey, useMidiOutputs } from "@/lib/waves";

export function WavesSettings({ w, onChange }: { w: W; onChange: (patch: Partial<W>) => void }) {
  const { outputs, error } = useMidiOutputs(true);
  const connected = Boolean(w.output && outputs?.includes(w.output));
  useEffect(() => {
    if (location.hash === "#waves") setTimeout(() => document.getElementById("waves")?.scrollIntoView({ behavior: "smooth" }), 80);
  }, []);

  const test = async (id: string) => {
    try {
      const n = await sendKey({ ...w, enabled: true }, id);
      toast.success(`Sent ${id}`, { description: `SuperRack snapshot ${n}` });
    } catch (e) { toast.error("Couldn’t send", { description: (e as Error).message }); }
  };

  return (
    <section id="waves" className="panel scroll-mt-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><AudioLines size={16} /> Waves SuperRack</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Press a song’s key on a service’s Tuning bar and SuperRack recalls the snapshot you’ve set up for that key
            (for example, Waves Tune Real-Time set to that key), over MIDI.
          </p>
        </div>
        <button role="switch" aria-checked={w.enabled} aria-label="Waves SuperRack" onClick={() => onChange({ enabled: !w.enabled })}
          className={clsx("relative h-6 w-11 shrink-0 rounded-full transition", w.enabled ? "bg-ok" : "bg-line-strong")}>
          <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", w.enabled ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>

      <div className={clsx("mt-3 rounded-lg border px-3 py-2 text-xs",
        error ? "border-bad/30 bg-bad-soft text-bad" : !w.enabled ? "border-line text-ink-muted"
          : connected ? "border-ok/30 bg-ok-soft text-ok" : "border-warn/30 bg-warn-soft text-warn")}>
        {error ? `MIDI isn’t available: ${error}`
          : !outputs ? "Looking for MIDI outputs…"
          : !w.enabled ? "Off."
          : connected ? <>Ready · sending to <b>{w.output}</b> on channel {w.channel}</>
          : w.output ? `“${w.output}” isn’t connected right now.` : "Choose the MIDI output that goes to SuperRack."}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px]">
        <label className="block"><span className="label">MIDI output</span>
          <select className="input mt-1" value={w.output ?? ""} onChange={(e) => onChange({ output: e.target.value || null })}>
            <option value="">Choose…</option>
            {w.output && !outputs?.includes(w.output) && <option value={w.output}>{w.output} (not connected)</option>}
            {outputs?.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Channel</span>
          <select className="input mt-1" value={w.channel} onChange={(e) => onChange({ channel: Number(e.target.value) })}>
            {Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select>
        </label>
      </div>
      {outputs && outputs.length === 0 && (
        <p className="mt-2 text-xs text-warn">No MIDI outputs found. See the steps below to add one.</p>
      )}

      <div className="mt-5">
        <span className="label">Match each key to its Waves snapshot</span>
        <p className="mt-0.5 text-[11px] text-ink-faint">
          Type the SuperRack snapshot number for each key you use. Sharps and flats each have their own snapshot, and a
          minor key uses its letter’s snapshot (F#m → F#). Leave keys you don’t use empty. ▶ sends it now.
        </p>
        <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-9">
          {KEY_ROOTS.map((k) => (
            <div key={k} className="flex items-center gap-3 rounded-lg border border-line px-3 py-1.5">
              <span className="w-10 font-mono text-base font-semibold text-violet">{k}</span>
              <span className="text-[11px] text-ink-faint">Snapshot</span>
              <SnapInput value={w.snapshots[k]} onSave={(v) => onChange({ snapshots: { [k]: v } })} onTest={() => test(k)} />
            </div>
          ))}
        </div>
      </div>

      <details className="mt-5 rounded-lg border border-line px-3 py-2 text-[12px] text-ink-muted">
        <summary className="cursor-pointer text-ink-soft">How to connect SuperRack</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4">
          <li><b>SuperRack on this Mac:</b> open Audio MIDI Setup → Window → Show MIDI Studio → double-click <b>IAC Driver</b> →
            tick <b>Device is online</b>. Then choose “IAC Driver Bus 1” above.</li>
          <li><b>SuperRack on another computer:</b> Audio MIDI Setup → MIDI Studio → Network. Create a session on both computers
            and connect them. Choose that session above. (On Windows, use rtpMIDI.)</li>
          <li>In SuperRack: Controllers → add <b>MIDI Controller</b> → the gear icon → under MIDI IN tick the IAC or network port.</li>
          <li>Save a SuperRack snapshot for each key you use (e.g. Waves Tune Real-Time set to A), and enter its number next to that key here.</li>
        </ol>
        <p className="mt-2">Cool Services sends Bank LSB (CC 32) and a Program Change, which is how SuperRack recalls snapshots 1–384.</p>
      </details>
    </section>
  );
}

function SnapInput({ value, onSave, onTest }: { value: number | null | undefined; onSave: (v: number | null) => void; onTest: () => void }) {
  const [v, setV] = useState(value ? String(value) : "");
  useEffect(() => setV(value ? String(value) : ""), [value]);
  const commit = () => {
    const n = v ? Math.min(384, Math.max(1, Number(v))) : null;
    setV(n ? String(n) : "");
    if (n !== (value ?? null)) onSave(n);
  };
  return (
    <div className="ml-auto flex items-center gap-1">
      <input className="input w-20 py-1 text-center font-mono text-sm" inputMode="numeric" placeholder="—" value={v}
        onChange={(e) => setV(e.target.value.replace(/\D/g, "").slice(0, 3))} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
      <button className="btn-ghost p-1" title="Send now" disabled={!value} onClick={onTest}><Play size={12} /></button>
    </div>
  );
}
