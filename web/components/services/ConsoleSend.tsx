"use client";
/**
 * "Send names to console": the assigned people's first names go to each mic's Allen & Heath
 * input(s) (dLive / Avantis). Mics nobody is on get their own label back ("Vox 3").
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { SlidersVertical } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Api, qk } from "@/lib/api";
import { Modal, Spinner } from "@/components/ui";
import { PrefsLink } from "@/components/settings/PrefsLink";

export function ConsoleSendButton({ planId }: { planId: string }) {
  const [open, setOpen] = useState(false);
  const cfg = useQuery({ queryKey: qk.consoleConfig, queryFn: Api.consoleConfig, staleTime: 30_000 });
  const model = cfg.data?.model === "avantis" ? "Avantis" : "dLive";
  return (
    <>
      <button className="btn-outline py-1 text-xs" onClick={() => setOpen(true)} title={`Send names to the ${model}`}>
        <SlidersVertical size={13} /> Names to {model}
      </button>
      {open && <SendModal planId={planId} model={model} ready={Boolean(cfg.data?.enabled && cfg.data.host)} onClose={() => setOpen(false)} />}
    </>
  );
}

function SendModal({ planId, model, ready, onClose }: { planId: string; model: string; ready: boolean; onClose: () => void }) {
  const preview = useQuery({ queryKey: qk.consolePreview(planId), queryFn: () => Api.consolePreview(planId) });
  const send = useMutation({
    mutationFn: () => Api.sendConsole(planId),
    onSuccess: (r) => { toast.success(`Sent ${r.sent} name${r.sent === 1 ? "" : "s"} to the ${model}`); onClose(); },
    onError: (e) => toast.error(`Couldn’t send to the ${model}`, { description: (e as Error).message }),
  });
  const rows = preview.data?.rows ?? [];
  return (
    <Modal open onClose={onClose} title={`Send names to the ${model}`} width={520}>
      <div className="p-5">
        {!ready && (
          <div className="mb-3 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-warn">
            The console isn’t set up yet. <PrefsLink section="console" className="underline">Preferences → Audio</PrefsLink>
          </div>
        )}
        {preview.isLoading ? <Spinner /> : !rows.length ? (
          <p className="text-sm text-ink-muted">No mics are set to go to the console. In <b>Set up mics</b> (⚙ on the Mics panel), tick <b>Console</b> on each mic and enter its input.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-muted"><th className="pb-1.5">Mic</th><th className="pb-1.5">Input</th><th className="pb-1.5">Name on the console</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.micId} className="border-t border-line">
                  <td className="py-1.5 pr-2">{r.micLabel}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs">{r.inputs.join(" + ")}</td>
                  <td className="py-1.5"><span className="rounded bg-canvas px-1.5 py-0.5 font-mono">{r.name}</span>{!r.person && <span className="ml-2 text-[11px] text-ink-faint">nobody on it</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-[11px] text-ink-faint">Only channel names change on the console. Names are up to 8 letters, so first names are used (with a last initial when two people share one).</p>
      </div>
      <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!ready || !rows.length || send.isPending} onClick={() => send.mutate()}>{send.isPending && <Spinner />} Send to {model}</button>
      </footer>
    </Modal>
  );
}
