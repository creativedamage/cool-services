"use client";
/** Set up mics: the Shure receivers on the network and the channels (Vox 1, AG Pack…) on them. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2, Wifi } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { MicChannel, MicSetup, Receiver, ShureModel } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { MODEL_LABEL } from "@/lib/mics";
import { Modal, Spinner } from "@/components/ui";

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

export function MicSetupModal({ setup, positions, onClose }: { setup: MicSetup; positions: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [rxs, setRxs] = useState<Receiver[]>(setup.receivers);
  const [chs, setChs] = useState<MicChannel[]>(setup.channels);
  const [tests, setTests] = useState<Record<string, { busy?: boolean; ok?: boolean; msg?: string }>>({});

  const save = useMutation({
    mutationFn: () => Api.saveMicSetup({ receivers: rxs, channels: chs }),
    onSuccess: (s) => { qc.setQueryData(qk.micSetup, s); toast.success("Mic setup saved"); onClose(); },
    onError: (e) => toast.error("Couldn’t save", { description: (e as Error).message }),
  });

  const upRx = (id: string, patch: Partial<Receiver>) => setRxs((xs) => xs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const upCh = (id: string, patch: Partial<MicChannel>) => setChs((xs) => xs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  async function test(r: Receiver) {
    setTests((t) => ({ ...t, [r.id]: { busy: true } }));
    const res = await Api.testReceiver(r.ip).catch((e) => ({ ok: false, error: (e as Error).message, deviceId: undefined }));
    setTests((t) => ({ ...t, [r.id]: { ok: res.ok, msg: res.ok ? `Connected${res.deviceId ? ` · ${res.deviceId}` : ""}` : res.error } }));
  }

  return (
    <Modal open onClose={onClose} width={860} title="Set up mics">
      <div className="max-h-[70vh] space-y-6 overflow-y-auto p-5">
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Shure receivers</h3>
            <button className="btn-ghost py-1 text-xs" onClick={() => setRxs([...rxs, { id: uid("rx"), name: `Rack ${String.fromCharCode(65 + rxs.length)}`, model: "ULXD", ip: "", channels: 4 }])}>
              <Plus size={13} /> Add receiver
            </button>
          </div>
          <p className="mb-3 text-xs text-ink-muted">
            ULX-D, QLX-D, SLX-D and Axient Digital. Use the IP address shown on the receiver’s network menu or in Wireless Workbench.
            This Mac must be on the same network. Cool Services only <strong>reads</strong> battery, antenna and signal info. It never
            changes anything on the receivers or in Wireless Workbench. Leave the IP blank for mics you just want to assign.
          </p>
          <div className="space-y-2">
            {rxs.map((r) => (
              <div key={r.id} className="grid grid-cols-[1fr_150px_170px_90px_auto_auto] items-center gap-2">
                <input className="input py-1.5" value={r.name} onChange={(e) => upRx(r.id, { name: e.target.value })} placeholder="Name" />
                <select className="input py-1.5" value={r.model} onChange={(e) => upRx(r.id, { model: e.target.value as ShureModel })}>
                  {(Object.keys(MODEL_LABEL) as ShureModel[]).map((m) => <option key={m} value={m}>{MODEL_LABEL[m]}</option>)}
                </select>
                <input className="input py-1.5 font-mono text-xs" value={r.ip} onChange={(e) => upRx(r.id, { ip: e.target.value.trim() })} placeholder="192.168.1.50" />
                <select className="input py-1.5" value={r.channels} onChange={(e) => upRx(r.id, { channels: Number(e.target.value) })}>
                  {[1, 2, 4].map((n) => <option key={n} value={n}>{n} ch</option>)}
                </select>
                <button className="btn-outline py-1.5 text-xs" disabled={!r.ip || tests[r.id]?.busy} onClick={() => test(r)}>
                  {tests[r.id]?.busy ? <Spinner size={11} /> : tests[r.id]?.ok ? <Check size={13} className="text-ok" /> : <Wifi size={13} />} Test
                </button>
                <button className="btn-ghost p-1.5" title="Remove" onClick={() => {
                  setRxs(rxs.filter((x) => x.id !== r.id));
                  setChs(chs.map((c) => (c.receiverId === r.id ? { ...c, receiverId: null } : c)));
                }}><Trash2 size={14} /></button>
                {tests[r.id]?.msg && <div className={`col-span-6 -mt-1 text-[11px] ${tests[r.id]?.ok ? "text-ok" : "text-bad"}`}>{tests[r.id]?.msg}</div>}
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Mics &amp; packs</h3>
            <button className="btn-ghost py-1 text-xs" onClick={() => setChs([...chs, { id: uid("ch"), label: `Vox ${chs.filter((c) => c.kind === "vocal").length + 1}`, kind: "vocal", receiverId: rxs[0]?.id ?? null, channel: 1, positions: ["Vocals"] }])}>
              <Plus size={13} /> Add mic
            </button>
          </div>
          <p className="mb-3 text-xs text-ink-muted">
            “For positions” drives Auto-assign: e.g. Vox 1 → Worship Leader, Vox 2–4 → Vocals, AG Pack → Acoustic Guitar.
            People go back on the same mic they had last time when it fits.
          </p>
          <datalist id="cs-positions">{positions.map((p) => <option key={p} value={p} />)}</datalist>
          <div className="space-y-2">
            {chs.map((c) => {
              const rx = rxs.find((r) => r.id === c.receiverId);
              return (
                <div key={c.id} className="grid grid-cols-[130px_110px_1fr_80px_1.3fr_auto] items-center gap-2">
                  <input className="input py-1.5" value={c.label} onChange={(e) => upCh(c.id, { label: e.target.value })} placeholder="Vox 1" />
                  <select className="input py-1.5" value={c.kind} onChange={(e) => upCh(c.id, { kind: e.target.value as MicChannel["kind"] })}>
                    <option value="vocal">Vocal mic</option><option value="pack">Pack</option><option value="other">Other</option>
                  </select>
                  <select className="input py-1.5" value={c.receiverId ?? ""} onChange={(e) => upCh(c.id, { receiverId: e.target.value || null, channel: 1 })}>
                    <option value="">Not linked to a receiver</option>
                    {rxs.map((r) => <option key={r.id} value={r.id}>{r.name} ({MODEL_LABEL[r.model]})</option>)}
                  </select>
                  <select className="input py-1.5" value={c.channel} disabled={!rx} onChange={(e) => upCh(c.id, { channel: Number(e.target.value) })}>
                    {Array.from({ length: rx?.channels ?? 1 }, (_, i) => <option key={i} value={i + 1}>Ch {i + 1}</option>)}
                  </select>
                  <input className="input py-1.5" list="cs-positions" value={c.positions.join(", ")} placeholder="For positions (comma-separated)"
                    onChange={(e) => upCh(c.id, { positions: e.target.value.split(",").map((s) => s.trimStart()).filter((s, i, a) => s || i === a.length - 1) })}
                    onBlur={(e) => upCh(c.id, { positions: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                  <button className="btn-ghost p-1.5" title="Remove" onClick={() => setChs(chs.filter((x) => x.id !== c.id))}><Trash2 size={14} /></button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Save</button>
      </footer>
    </Modal>
  );
}
