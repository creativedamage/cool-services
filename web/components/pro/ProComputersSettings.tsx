"use client";
/** Settings → ProPresenter computers: the ones Sundays can watch and control. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorUp, Plus, Radar, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ProMachine } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { Spinner } from "@/components/ui";

type Row = { id?: string; name: string; host: string; port: string };

export function ProComputersSettings() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: qk.proMachines, queryFn: Api.proMachines });
  const [rows, setRows] = useState<Row[] | null>(null);
  const own = (list.data ?? []).filter((m) => !m.builtIn);
  const builtIn = (list.data ?? []).filter((m) => m.builtIn);
  useEffect(() => { if (list.data && !rows) setRows(own.map((m) => ({ id: m.id, name: m.name, host: m.host, port: String(m.port) }))); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => Api.saveProMachines((rows ?? []).filter((r) => r.host.trim()).map((r) => ({ id: r.id ?? "", name: r.name.trim() || r.host, host: r.host.trim(), port: Number(r.port) }))),
    onSuccess: (m) => { qc.setQueryData(qk.proMachines, m); setRows(m.filter((x) => !x.builtIn).map((x) => ({ id: x.id, name: x.name, host: x.host, port: String(x.port) }))); toast.success("ProPresenter computers saved"); },
    onError: (e) => toast.error("Couldn’t save", { description: (e as Error).message }),
  });
  const find = useMutation({ mutationFn: () => Api.discoverPro() });
  const set = (i: number, p: Partial<Row>) => setRows((r) => (r ?? []).map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <section id="pro-computers" className="panel scroll-mt-6 p-5">
      <h2 className="flex items-center gap-2 font-semibold"><MonitorUp size={16} /> ProPresenter computers</h2>
      <p className="mt-0.5 text-sm text-ink-muted">
        Computers you can watch and take over from the ProPresenter page and the dashboard (slides, timers, stage). Turn on
        Settings → Network in ProPresenter on each one.
      </p>
      {builtIn.map((m) => (
        <div key={m.id} className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink-muted">
          <MonitorUp size={14} /> {m.name} · <span className="font-mono text-xs">{m.host}:{m.port}</span>
          <span className="ml-auto text-[11px]">from Parent paging</span>
        </div>
      ))}
      <div className="mt-3 space-y-2">
        {(rows ?? []).map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_90px_auto] gap-2">
            <input className="input py-1.5" placeholder="Side screens" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            <input className="input py-1.5 font-mono text-sm" placeholder="192.168.1.21" value={r.host} onChange={(e) => set(i, { host: e.target.value.trim() })} />
            <input className="input py-1.5 font-mono text-sm" placeholder="port" value={r.port} onChange={(e) => set(i, { port: e.target.value.replace(/\D/g, "") })} />
            <button className="btn-ghost p-1.5" title="Remove" onClick={() => setRows((x) => (x ?? []).filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-ghost text-xs" onClick={() => setRows((r) => [...(r ?? []), { name: "", host: "", port: "" }])}><Plus size={13} /> Add a computer</button>
        <button className="btn-ghost text-xs" disabled={find.isPending} onClick={() => find.mutate()}>{find.isPending ? <Spinner size={11} /> : <Radar size={13} />} Find automatically</button>
        <button className="btn-primary ml-auto text-xs" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner size={11} />} Save</button>
      </div>
      {find.data && (
        <div className="mt-2 space-y-1">
          {find.data.length === 0 && <p className="text-xs text-ink-muted">None found. Type the IP and port from ProPresenter → Settings → Network.</p>}
          {find.data.map((m: { host: string; port: number; name: string; version: string }) => (
            <button key={`${m.host}:${m.port}`} className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-left text-sm hover:border-accent/50"
              onClick={() => setRows((r) => [...(r ?? []), { name: m.name || m.host, host: m.host, port: String(m.port) }])}>
              <MonitorUp size={13} className="text-accent" /> {m.name || m.host} <span className="text-[11px] text-ink-muted">{m.version} · {m.host}:{m.port}</span>
              <span className="ml-auto text-[11px] text-accent">Add</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
