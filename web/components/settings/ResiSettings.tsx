"use client";
/**
 * Preferences → Video → Resi: the API client from Resi Studio, so Sundays can show when you're
 * live (the Dashboard's Resi widget and the badge on Services). Read-only: it never starts or stops
 * anything in Resi.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Loader2, Radio, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Api, qk } from "@/lib/api";

export function ResiSettings() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["resiSettings"], queryFn: Api.resiSettings });
  const status = useQuery({ queryKey: qk.resi, queryFn: Api.resi, refetchInterval: 10_000 });
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [encoders, setEncoders] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => { if (settings.data) setId(settings.data.clientId); }, [settings.data]);
  const save = useMutation({
    mutationFn: Api.saveResiSettings,
    onSuccess: (r) => {
      qc.setQueryData(["resiSettings"], r.settings); qc.setQueryData(qk.resi, r.status); setSecret("");
      if (r.status.connected) { toast.success("Connected to Resi"); void test.mutate(); }
      else if (r.settings.enabled && r.status.error) toast.error("Resi didn’t connect", { description: r.status.error });
    },
    onError: (e) => toast.error("Couldn’t save", { description: (e as Error).message }),
  });
  const test = useMutation({
    mutationFn: Api.testResi,
    onSuccess: (r) => { qc.setQueryData(qk.resi, r.status); setEncoders(r.encoders); },
  });
  const s = settings.data;
  if (!s) return null;
  const st = status.data;
  const watch = new Set(s.encoderIds);
  const toggle = (encId: string) => save.mutate({ encoderIds: watch.has(encId) ? s.encoderIds.filter((x) => x !== encId) : [...s.encoderIds, encId] });

  return (
    <section id="resi" className="panel scroll-mt-6 space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-semibold"><Radio size={16} className="text-rose-500" /> Resi</h2>
        {s.enabled && st && (
          <span className={clsx("rounded-full px-2 py-0.5 text-xs", !st.connected ? "bg-bad-soft text-bad" : st.live ? "bg-rose-600 text-white" : "bg-ok-soft text-ok")}>
            {!st.connected ? "Not connected" : st.live ? "Live now" : "Connected · off air"}
          </span>
        )}
        <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={s.enabled} onChange={(e) => save.mutate({ enabled: e.target.checked })} /> Show Resi status</label>
      </div>
      <p className="text-sm text-ink-muted">
        Shows when your Resi stream is live: a <b>Resi live</b> badge on Services and the <b>Resi</b> widget on the Dashboard (where it’s going, how long it’s been live).
        Sundays only reads from Resi; it never starts or stops a stream.
      </p>
      <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); save.mutate({ enabled: true, clientId: id, ...(secret ? { clientSecret: secret } : {}) }); }}>
        <label className="block"><span className="text-xs text-ink-muted">Client ID</span>
          <input className="input mt-1 font-mono text-xs" value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label className="block"><span className="text-xs text-ink-muted">Client Secret {s.hasSecret && <span className="text-ink-faint">(saved; type to replace)</span>}</span>
          <input className="input mt-1 font-mono text-xs" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={s.hasSecret ? "••••••••••••" : ""} autoComplete="off" />
        </label>
        <button className="btn-primary self-end" disabled={!id.trim() || (!secret && !s.hasSecret) || save.isPending}>{save.isPending ? <Loader2 size={14} className="animate-spin" /> : null} Connect</button>
      </form>
      <p className="text-[11px] text-ink-faint">Make the API client in Resi Studio (your account’s API settings; Resi support can turn on API access if you don’t see it). The secret is saved encrypted on this Mac.</p>
      {st?.error && s.enabled && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{st.error}</p>}

      {s.enabled && st?.connected && (
        <div className="space-y-2 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Encoders to watch</span>
            <span className="text-xs text-ink-muted">{watch.size ? `${watch.size} chosen` : "All of them"}</span>
            <button className="btn-ghost ml-auto py-1 text-xs" onClick={() => test.mutate()} disabled={test.isPending}><RefreshCw size={12} className={test.isPending ? "animate-spin" : ""} /> Check now</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(encoders ?? st.encoders).map((e) => (
              <button key={e.id} onClick={() => toggle(e.id)}
                className={clsx("rounded-full border px-3 py-1 text-xs", watch.has(e.id) ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-soft hover:border-line-strong")}>
                {e.name}
              </button>
            ))}
            {encoders === null && !st.encoders.length && <span className="text-xs text-ink-faint">Press Check now to list your encoders.</span>}
          </div>
          <p className="text-[11px] text-ink-faint">
            {st.source === "schedules" ? "Live comes from Resi’s live schedules (each destination’s state)." : "Live comes from each encoder’s own status."}
            {st.checkedAt ? ` Checked ${new Date(st.checkedAt).toLocaleTimeString()}.` : ""}
          </p>
        </div>
      )}
    </section>
  );
}
