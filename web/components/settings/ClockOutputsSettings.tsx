"use client";
/**
 * Preferences → Video → Clock outputs: where the production clock shows. NDI (any NDI receiver:
 * ProPresenter, vMix, OBS, TriCaster…), the church network (TVs, iPads, stage displays in a
 * browser), a second display on this Mac, and Stream Deck / Companion control links.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Copy, KeyRound, MonitorUp, Radio, Timer, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ClockView } from "@shared/clock";
import { Api } from "@/lib/api";
import { Spinner } from "@/components/ui";

const KEY = ["clock"];

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={clsx("relative h-6 w-11 shrink-0 rounded-full transition", on ? "bg-ok" : "bg-line-strong")}>
      <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

export function ClockOutputsSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: Api.clock, refetchInterval: 3000 });
  const save = useMutation({
    mutationFn: Api.saveClockSettings,
    onSuccess: (settings) => { qc.setQueryData<ClockView>(KEY, (v) => v && { ...v, settings }); setTimeout(() => void q.refetch(), 800); },
    onError: (e) => toast.error("Couldn’t save", { description: (e as Error).message }),
  });
  const rekey = useMutation({ mutationFn: Api.newClockKey, onSuccess: (settings) => qc.setQueryData<ClockView>(KEY, (v) => v && { ...v, settings }) });
  const [name, setName] = useState("");
  useEffect(() => { if (q.data) setName(q.data.settings.ndi.name); }, [q.data?.settings.ndi.name]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!q.data) return <section id="clock" className="panel p-5"><Spinner /></section>;
  const { settings: s, status, urls } = q.data;
  const ndi = status.ndi;
  const base = urls[0]?.replace(/\/clock$/, "");
  const ctl = (a: string) => (base ? `${base}/api/clock-out/control/${s.controlKey}/${a}` : null);
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success("Copied"));

  return (
    <section id="clock" className="panel scroll-mt-6 space-y-5 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold"><Timer size={16} /> Clock outputs</h2>
        <p className="mt-0.5 text-sm text-ink-muted">Where the production clock (sidebar → Clock) shows. Every output shows the same thing as the preview on the Clock page.</p>
      </div>

      {/* NDI */}
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Radio size={14} /> NDI®</h3>
            <p className="mt-0.5 text-[13px] text-ink-muted">Sends the clock as an NDI source on the network, for ProPresenter, vMix, OBS, a TriCaster or an NDI monitor.</p>
          </div>
          <Switch label="NDI" on={s.ndi.enabled} onChange={(v) => save.mutate({ ndi: { enabled: v } })} />
        </div>
        <div className={clsx("mt-3 rounded-lg border px-3 py-2 text-xs",
          s.ndi.enabled && ndi.error ? "border-bad/30 bg-bad-soft text-bad" : s.ndi.enabled && ndi.running ? "border-ok/30 bg-ok-soft text-ok" : "border-line text-ink-muted")}>
          {!ndi.available ? (ndi.error ?? "NDI isn’t available here.")
            : !s.ndi.enabled ? "Off."
            : ndi.error ? ndi.error
            : ndi.running ? <>Sending as <b>{ndi.sourceName}</b> · {ndi.connections} {ndi.connections === 1 ? "receiver" : "receivers"} watching</> : "Starting…"}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="block sm:col-span-2"><span className="label block">Source name</span>
            <input className="input mt-1 text-sm" value={name} maxLength={60} onChange={(e) => setName(e.target.value)}
              onBlur={() => { if (name.trim() && name.trim() !== s.ndi.name) save.mutate({ ndi: { name: name.trim() } }); }} />
          </label>
          <label className="block"><span className="label block">Size</span>
            <select className="input mt-1 text-sm" value={s.ndi.resolution} onChange={(e) => save.mutate({ ndi: { resolution: e.target.value as "720p" | "1080p" } })}>
              <option value="1080p">1920×1080</option><option value="720p">1280×720</option>
            </select>
          </label>
          <label className="block"><span className="label block">Frame rate</span>
            <select className="input mt-1 text-sm" value={s.ndi.fps} onChange={(e) => save.mutate({ ndi: { fps: Number(e.target.value) as 30 } })}>
              {[25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
            </select>
          </label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={s.ndi.transparent} onChange={(e) => save.mutate({ ndi: { transparent: e.target.checked } })} />
          Transparent background (key the clock over video; the receiver must use NDI’s alpha channel)
        </label>
        <p className="mt-2 text-[11px] text-ink-faint">Receivers see it as “{ndi.sourceName ?? `THIS-MAC (${s.ndi.name})`}”. NDI® is a registered trademark of Vizrt NDI AB (ndi.video).</p>
      </div>

      {/* Network */}
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Wifi size={14} /> On the church network</h3>
            <p className="mt-0.5 text-[13px] text-ink-muted">Open the clock full screen in any browser: a TV, an iPad on the stage, a confidence monitor. Uses the same port as the Kids &amp; Nursery iPads.</p>
          </div>
          <Switch label="Network clock" on={s.lan} onChange={(v) => save.mutate({ lan: v })} />
        </div>
        {s.lan && (
          <ul className="mt-3 space-y-1">
            {urls.map((u) => (
              <li key={u} className="flex items-center gap-2 font-mono text-sm">
                <span className="select-all">{u}</span>
                <button className="btn-ghost p-1" onClick={() => copy(u)}><Copy size={12} /></button>
              </li>
            ))}
            {!urls.length && <li className="text-xs text-ink-muted">Starting…</li>}
          </ul>
        )}
      </div>

      {/* Second display */}
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold"><MonitorUp size={14} /> Second display on this Mac</h3>
            <p className="mt-0.5 text-[13px] text-ink-muted">Shows the clock full screen on another display connected to this Mac (a stage monitor or a TV).</p>
          </div>
          <Switch label="Second display" on={s.screen.enabled} onChange={(v) => save.mutate({ screen: { enabled: v, displayId: s.screen.displayId ?? status.displays.find((d) => !d.primary)?.id ?? null } })} />
        </div>
        {status.displays.length > 0 ? (
          <select className="input mt-3 w-auto text-sm" value={s.screen.displayId ?? ""} onChange={(e) => save.mutate({ screen: { displayId: Number(e.target.value) } })}>
            {status.displays.map((d) => <option key={d.id} value={d.id}>{d.label}{d.primary ? " (main display)" : ""}</option>)}
          </select>
        ) : <p className="mt-2 text-xs text-ink-muted">Displays are listed in the Sundays Mac app.</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label block">Title bar</span>
          <input className="input mt-1 text-sm" defaultValue={s.title} maxLength={40} placeholder="Empty: no title bar" onBlur={(e) => e.target.value !== s.title && save.mutate({ title: e.target.value })} />
        </label>
        <label className="block"><span className="label block">Information heading</span>
          <input className="input mt-1 text-sm" defaultValue={s.infoHeading} maxLength={30} onBlur={(e) => e.target.value !== s.infoHeading && save.mutate({ infoHeading: e.target.value })} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" checked={s.showTimeOfDay} onChange={(e) => save.mutate({ showTimeOfDay: e.target.checked })} /> Show the time of day in the left box when there’s no second timer
      </label>

      {/* Companion */}
      <div className="rounded-xl border border-line p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><KeyRound size={14} /> Stream Deck / Bitfocus Companion</h3>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Each link below runs the clock when it’s opened (Companion: Generic HTTP → GET). Needs <b>On the church network</b> turned on.
          {" "}Anyone with these links can run the clock; <button className="text-accent hover:underline" onClick={() => rekey.mutate()}>make new links</button> to turn the old ones off.
        </p>
        {s.lan && base ? (
          <ul className="mt-2 space-y-1 text-xs">
            {[["Start / pause", "toggle"], ["Start", "start"], ["Pause", "pause"], ["Reset", "reset"], ["Next timer", "next"], ["Previous timer", "prev"], ["+1 minute", "add/60"], ["−1 minute", "add/-60"],
              ["Start timer #1", "load/1"], ["Start timer by name", "load/Walk-in"], ["Show a message", "message/Wrap%20it%20up"], ["Clear message", "clear-message"], ["Blank", "blank"], ["Unblank", "unblank"]].map(([label, a]) => (
              <li key={a} className="flex items-center gap-2">
                <span className="w-36 shrink-0 text-ink-muted">{label}</span>
                <span className="min-w-0 flex-1 select-all truncate font-mono">{ctl(a)}</span>
                <button className="btn-ghost p-1" onClick={() => copy(ctl(a)!)}><Copy size={12} /></button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-xs text-ink-muted">Turn on “On the church network” to get the links.</p>}
      </div>
    </section>
  );
}
