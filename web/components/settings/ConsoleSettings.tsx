"use client";
/** Preferences → Audio → Allen & Heath: the dLive / Avantis that gets channel names from the Mics tab. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { SlidersVertical } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ConsoleSettingsView as C } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { Spinner } from "@/components/ui";

const PORTS = { "dlive-rack": 51325, "dlive-surface": 51328, avantis: 51325 } as const;

export function ConsoleSettings() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: qk.consoleConfig, queryFn: Api.consoleConfig });
  const [f, setF] = useState({ host: "", port: "51325", midi: "1" });
  useEffect(() => { if (cfg.data) setF({ host: cfg.data.host, port: String(cfg.data.port), midi: String(cfg.data.midiChannel) }); }, [cfg.data]);
  const save = useMutation({
    mutationFn: (p: Partial<C>) => Api.saveConsole(p),
    onSuccess: (c) => qc.setQueryData(qk.consoleConfig, c),
    onError: (e) => toast.error("Couldn’t save", { description: (e as Error).message }),
  });
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const test = useMutation({
    mutationFn: async () => { await Api.saveConsole({ host: f.host, port: Number(f.port) || 51325, midiChannel: Number(f.midi) || 1 }); return Api.testConsole(); },
    onSuccess: (r) => setResult(r.ok ? { ok: true, text: r.note ?? `Connected. Input 1 is “${r.input1}”.` } : { ok: false, text: r.error ?? "Couldn’t connect." }),
  });
  const c = cfg.data;
  if (!c) return <section className="panel p-5"><Spinner /></section>;
  const apply = (p: Partial<C>) => save.mutate(p);
  const commit = () => apply({ host: f.host, port: Number(f.port) || 51325, midiChannel: Math.min(16, Math.max(1, Number(f.midi) || 1)) });
  const kind = c.model === "avantis" ? "avantis" : c.port === PORTS["dlive-surface"] ? "dlive-surface" : "dlive-rack";

  return (
    <section id="console" className="panel scroll-mt-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><SlidersVertical size={16} /> Allen &amp; Heath console</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Puts the names from a service’s Mics tab on dLive or Avantis channels (“Names to dLive” on the Mics panel). In <b>Set up mics</b>, tick Console on each mic and enter its input, plus a second input for a double patch (e.g. in-ears).
          </p>
        </div>
        <button role="switch" aria-checked={c.enabled} aria-label="Allen & Heath console" onClick={() => apply({ enabled: !c.enabled })}
          className={clsx("relative h-6 w-11 shrink-0 rounded-full transition", c.enabled ? "bg-ok" : "bg-line-strong")}>
          <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", c.enabled ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1.2fr_1fr_90px_90px]">
        <label className="block"><span className="label">Console</span>
          <select className="input mt-1" value={kind} onChange={(e) => {
            const k = e.target.value as keyof typeof PORTS;
            const model = k === "avantis" ? "avantis" : "dlive";
            const midiChannel = model === c.model ? c.midiChannel : model === "avantis" ? 12 : 1;
            setF({ ...f, port: String(PORTS[k]), midi: String(midiChannel) });
            apply({ model, port: PORTS[k], midiChannel });
          }}>
            <option value="dlive-rack">dLive (MixRack)</option>
            <option value="dlive-surface">dLive (Surface)</option>
            <option value="avantis">Avantis</option>
          </select>
        </label>
        <label className="block"><span className="label">IP address</span>
          <input className="input mt-1 font-mono text-sm" placeholder="192.168.1.70" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value.trim() })} onBlur={commit} />
        </label>
        <label className="block"><span className="label">Port</span>
          <input className="input mt-1 font-mono text-sm" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value.replace(/\D/g, "") })} onBlur={commit} />
        </label>
        <label className="block"><span className="label">MIDI ch.</span>
          <input className="input mt-1 font-mono text-sm" value={f.midi} onChange={(e) => setF({ ...f, midi: e.target.value.replace(/\D/g, "").slice(0, 2) })} onBlur={commit} />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        MIDI ch. is the console’s base MIDI channel: dLive Utility → Control → MIDI (usually 1); Avantis Setup → Control → MIDI (usually 12). The console and this Mac need to be on the same network.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn-outline text-xs" disabled={!f.host || test.isPending} onClick={() => test.mutate()}>{test.isPending && <Spinner size={11} />} Test connection</button>
        {result && <span className={clsx("text-xs", result.ok ? "text-ok" : "text-bad")}>{result.text}</span>}
      </div>
    </section>
  );
}
