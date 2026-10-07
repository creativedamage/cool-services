"use client";
/**
 * Set up mics: the Shure receivers on the network and the channels (Vox 1, AG Pack…) on them, plus
 * the service type's own mic assignment filter (its own "for positions", and hiding people who
 * already have a mic).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { MicChannel, MicSetup, Receiver, ShureModel } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { MODEL_LABEL } from "@/lib/mics";
import { Modal, Spinner } from "@/components/ui";

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

export function MicSetupModal({ setup, serviceType, positions, onClose }: {
  setup: MicSetup; serviceType: { id: string; name: string }; positions: string[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [rxs, setRxs] = useState<Receiver[]>(setup.receivers);
  const [chs, setChs] = useState<MicChannel[]>(setup.channels);
  const filter = setup.serviceTypes?.[serviceType.id] ?? {};
  /** This service type uses its own "for positions" instead of the ones every service type shares. */
  const [own, setOwn] = useState(Boolean(filter.positions));
  const [ownPos, setOwnPos] = useState<Record<string, string[]>>(filter.positions ?? {});
  const [hide, setHide] = useState(filter.hideAssigned !== false);
  const posOf = (c: MicChannel) => (own ? ownPos[c.id] ?? c.positions : c.positions);
  const setPos = (c: MicChannel, p: string[]) => (own ? setOwnPos((x) => ({ ...x, [c.id]: p })) : upCh(c.id, { positions: p }));
  const [tests, setTests] = useState<Record<string, { busy?: boolean; ok?: boolean; msg?: string }>>({});

  const save = useMutation({
    mutationFn: () => Api.saveMicSetup({
      receivers: rxs, channels: chs,
      serviceTypes: {
        ...setup.serviceTypes,
        [serviceType.id]: { positions: own ? Object.fromEntries(chs.map((c) => [c.id, posOf(c)])) : undefined, hideAssigned: hide },
      },
    }),
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
    <Modal open onClose={onClose} width={1040} title="Set up mics">
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
            This Mac must be on the same network. Sundays only <strong>reads</strong> battery, antenna and signal info. It never
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
            <b> Console</b> sends the person’s name to that Allen &amp; Heath input (a second input for a double patch, e.g. in-ears).
          </p>
          <div className="mb-3 space-y-1.5 rounded-lg border border-line bg-raised px-3 py-2.5 text-xs">
            <div className="font-semibold text-ink">Mic assignment filter for {serviceType.name}</div>
            <label className="flex items-center gap-2 text-ink-soft">
              <input type="checkbox" checked={own} onChange={(e) => {
                if (e.target.checked) setOwnPos(Object.fromEntries(chs.map((c) => [c.id, ownPos[c.id] ?? c.positions])));
                setOwn(e.target.checked);
              }} />
              Use different “For positions” for {serviceType.name}
              <span className="text-ink-faint">{own ? "(the positions below are only for this service type)" : "(the positions below are shared by every service type without their own)"}</span>
            </label>
            <label className="flex items-center gap-2 text-ink-soft">
              <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />
              Hide people who already have a mic
              <span className="text-ink-faint">(someone on Vox 1 isn’t offered for Vox 2, but can still get a pack)</span>
            </label>
          </div>
          <datalist id="cs-positions">{positions.map((p) => <option key={p} value={p} />)}</datalist>
          <div className="space-y-2">
            {chs.map((c) => {
              const rx = rxs.find((r) => r.id === c.receiverId);
              return (
                <div key={c.id} className="grid grid-cols-[110px_105px_1fr_84px_1fr_170px_auto] items-center gap-2">
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
                  <input className={`input py-1.5 ${own ? "border-accent/50" : ""}`} list="cs-positions" value={posOf(c).join(", ")}
                    placeholder={own ? `For positions at ${serviceType.name}` : "For positions (comma-separated)"}
                    onChange={(e) => setPos(c, e.target.value.split(",").map((s) => s.trimStart()).filter((s, i, a) => s || i === a.length - 1))}
                    onBlur={(e) => setPos(c, e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
                  <ConsoleCell c={c} onChange={(consoleInputs) => upCh(c.id, { consoleInputs })} />
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

/** Console: tick to send this mic's name to an Allen & Heath input, plus an optional second input. */
function ConsoleCell({ c, onChange }: { c: MicChannel; onChange: (inputs: number[]) => void }) {
  const ins = c.consoleInputs ?? [];
  const on = ins.length > 0;
  return (
    <div className="flex items-center gap-1.5" title="Allen & Heath input(s) that get this mic’s name">
      <label className="flex items-center gap-1 text-[11px] text-ink-muted">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? [1] : [])} /> Console
      </label>
      <NumBox disabled={!on} placeholder="In" label="Console input" value={ins[0]} onCommit={(n) => onChange(n ? [n, ...ins.slice(1)] : ins)} />
      <NumBox disabled={!on} placeholder="2nd" label="Second console input (double patch, e.g. in-ears)" value={ins[1]}
        onCommit={(n) => onChange(n ? [ins[0] ?? 1, n] : ins.slice(0, 1))} />
    </div>
  );
}

function NumBox({ value, onCommit, disabled, placeholder, label }: { value: number | undefined; onCommit: (n: number | null) => void; disabled: boolean; placeholder: string; label: string }) {
  const [v, setV] = useState(value ? String(value) : "");
  useEffect(() => setV(value ? String(value) : ""), [value]);
  const commit = () => { const n = Number(v); onCommit(n >= 1 && n <= 128 ? n : null); if (!(n >= 1 && n <= 128)) setV(value && placeholder === "In" ? String(value) : ""); };
  return (
    <input className="input w-12 px-1.5 py-1.5 text-center font-mono text-xs" disabled={disabled} placeholder={placeholder} value={v} aria-label={label} title={label}
      onChange={(e) => setV(e.target.value.replace(/\D/g, "").slice(0, 3))} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
  );
}
