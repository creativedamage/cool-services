"use client";
/** Settings → Smaart (SPL): connect to Smaart v9's API and pick up SPL readings for the dashboard. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Gauge } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Api, qk } from "@/lib/api";
import { Spinner } from "@/components/ui";

export function SmaartSettings() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: qk.smaartConfig, queryFn: Api.smaartConfig });
  const st = useQuery({ queryKey: qk.smaartStatus, queryFn: Api.smaartStatus, refetchInterval: 2000 });
  const [f, setF] = useState({ host: "", port: "26000", password: "", path: "/api/v4/", limit: "95" });
  useEffect(() => { if (cfg.data) setF({ host: cfg.data.host, port: String(cfg.data.port), password: "", path: cfg.data.path, limit: String(cfg.data.limit) }); }, [cfg.data]);
  const save = useMutation({
    mutationFn: (p: Parameters<typeof Api.saveSmaart>[0]) => Api.saveSmaart(p),
    onSuccess: (c) => { qc.setQueryData(qk.smaartConfig, c); void st.refetch(); },
    onError: (e) => toast.error("Couldn’t save", { description: (e as Error).message }),
  });
  const c = cfg.data;
  const s = st.data;
  const apply = (enabled = c?.enabled ?? false) => save.mutate({ enabled, host: f.host, port: Number(f.port) || 26000, path: f.path || "/api/v4/", limit: Number(f.limit) || 95, ...(f.password ? { password: f.password } : {}) });

  return (
    <section id="smaart" className="panel scroll-mt-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Gauge size={16} /> Smaart (SPL)</h2>
          <p className="mt-0.5 text-sm text-ink-muted">Shows SPL from Smaart v9 on the dashboard. In Smaart, start logging on a calibrated input, then turn on Options → API.</p>
        </div>
        <button role="switch" aria-checked={Boolean(c?.enabled)} aria-label="Smaart" onClick={() => apply(!c?.enabled)}
          className={clsx("relative h-6 w-11 shrink-0 rounded-full transition", c?.enabled ? "bg-ok" : "bg-line-strong")}>
          <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", c?.enabled ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>

      <div className={clsx("mt-3 rounded-lg border px-3 py-2 text-xs",
        !s || s.state === "off" ? "border-line text-ink-muted" : s.state === "connected" ? "border-ok/30 bg-ok-soft text-ok" : s.state === "error" ? "border-bad/30 bg-bad-soft text-bad" : "border-line text-ink-muted")}>
        {!s || s.state === "off" ? "Off." : s.state === "connecting" ? "Connecting to Smaart…" : s.state === "error" ? s.error
          : s.readings.length ? `Connected · ${s.readings.length} SPL reading${s.readings.length === 1 ? "" : "s"}`
          : s.measurements.length ? `Connected · found ${s.measurements.map((m) => m.name).join(", ")}. Waiting for level data from ${s.measurements.length === 1 ? "it" : "them"}…`
          : "Connected. Waiting for Smaart to list its measurements (start a measurement in Smaart)."}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_100px_1fr]">
        <label className="block"><span className="label">Smaart computer (IP or name)</span>
          <input className="input mt-1 font-mono text-sm" placeholder="192.168.1.40" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value.trim() })} />
        </label>
        <label className="block"><span className="label">Port</span>
          <input className="input mt-1 font-mono text-sm" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label className="block"><span className="label">API password</span>
          <input className="input mt-1" type="password" placeholder={c?.hasPassword ? "•••••• (saved)" : "Only if you set one"} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </label>
        <label className="block"><span className="label">Loud limit (dB)</span>
          <input className="input mt-1 w-24 font-mono text-sm" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value.replace(/[^\d.]/g, "") })} />
          <span className="mt-1 block text-[11px] text-ink-faint">The dashboard turns amber 3 dB under this and red above it.</span>
        </label>
        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-xs text-ink-muted">Advanced</summary>
          <label className="mt-2 block"><span className="label">API path</span>
            <input className="input mt-1 w-40 font-mono text-sm" value={f.path} onChange={(e) => setF({ ...f, path: e.target.value })} />
          </label>
        </details>
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn-primary text-xs" disabled={save.isPending || !f.host} onClick={() => apply(true)}>{save.isPending && <Spinner size={11} />} Save and connect</button>
      </div>

      {s && s.state === "connected" && s.measurements.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {s.measurements.map((m) => (
            <span key={m.endpoint} className={clsx("rounded-full border px-2 py-0.5 text-[11px]", m.stream === "open" ? "border-ok/40 text-ok" : m.stream === "error" ? "border-bad/40 text-bad" : "border-line text-ink-muted")}
              title={m.endpoint}>
              {m.name} · {m.stream === "open" ? `streaming (${m.messages})` : m.stream === "error" ? "stream failed" : m.stream === "connecting" ? "opening…" : "not streaming"}{m.active ? "" : " · stopped in Smaart"}
            </span>
          ))}
        </div>
      )}
      {s && s.readings.length > 0 && (
        <div className="mt-4">
          <span className="label">Readings from Smaart</span>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {s.readings.map((r) => (
              <div key={r.key} className="flex items-center justify-between rounded-md border border-line px-2 py-1 text-xs">
                <span className="truncate text-ink-muted" title={r.approx ? "Worked out from the spectrum. Accurate only if the input is calibrated in Smaart." : undefined}>{r.label}{r.approx ? " ≈" : ""}</span><span className="font-mono tabular-nums">{r.value.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {s && s.state === "connected" && s.sample.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-ink-muted">What Smaart is sending (for troubleshooting)</summary>
          <button className="btn-ghost mt-1 py-0.5 text-[11px]" onClick={() => { void navigator.clipboard.writeText(s.sample.join("\n\n")).then(() => toast.success("Copied")); }}>Copy</button>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-canvas p-2 text-[10px] text-ink-muted">{s.sample.join("\n\n")}</pre>
        </details>
      )}
    </section>
  );
}
