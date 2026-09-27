"use client";
/**
 * Mics & packs — who's on which wireless channel for this service, plus live receiver status.
 *
 * Assignments live only in Cool Services. The Shure connection is READ-ONLY: it shows battery,
 * runtime, antennas and signal, and never changes anything on the receivers or in Wireless Workbench.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ChevronDown, Mic, MicOff, Radio, Settings2, Sparkles, Waves } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { ChannelStatus, MicAssignment, MicKind, PlanDetail, PlanMics } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { assignChannel, autoAssign, fitsChannel, servingPeople } from "@/lib/mics";
import { Avatar, Skeleton } from "@/components/ui";
import { MicSetupModal } from "./MicSetupModal";
import { ConsoleSendButton } from "./ConsoleSend";

const KIND: Record<MicKind, { label: string; icon: typeof Mic }> = {
  vocal: { label: "Vocal mics", icon: Mic },
  pack: { label: "Packs", icon: Radio },
  other: { label: "Other", icon: Waves },
};

export function MicPanel({ plan }: { plan: PlanDetail }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("coolservices.mics.open") !== "0"; } catch { return true; } });
  const [editing, setEditing] = useState(false);

  const setup = useQuery({ queryKey: qk.micSetup, queryFn: Api.micSetup, staleTime: Infinity });
  const mics = useQuery({ queryKey: qk.planMics(plan.id), queryFn: () => Api.planMics(plan.id) });
  const hasIps = (setup.data?.receivers ?? []).some((r) => r.ip);
  // Live receiver status every 4s while the panel is open.
  const status = useQuery({
    queryKey: qk.micStatus,
    queryFn: Api.micStatus,
    enabled: open && hasIps,
    refetchInterval: 4000,
    refetchIntervalInBackground: false,
  });

  const save = useMutation({
    mutationFn: (a: MicAssignment[]) => Api.savePlanMics(plan.id, a),
    onMutate: (a) => qc.setQueryData<PlanMics>(qk.planMics(plan.id), (m) => m && { ...m, assignments: a }),
    onSuccess: (m) => qc.setQueryData(qk.planMics(plan.id), m),
    onError: (e) => { toast.error("Couldn’t save mic assignments", { description: (e as Error).message }); void mics.refetch(); },
  });

  const people = useMemo(() => servingPeople(plan.roster), [plan.roster]);
  const assignments = mics.data?.assignments ?? [];
  const byChannel = new Map(assignments.map((a) => [a.channelId, a]));
  const channels = setup.data?.channels ?? [];
  const receivers = new Map((setup.data?.receivers ?? []).map((r) => [r.id, r]));
  const rxStatus = new Map((status.data ?? []).map((r) => [r.receiverId, r]));
  const assignedCount = channels.filter((c) => byChannel.has(c.id)).length;
  const offline = (status.data ?? []).filter((r) => !r.ok);

  function runAuto() {
    if (!setup.data || !mics.data) return;
    const next = autoAssign(setup.data, plan.roster, assignments, mics.data.usual);
    const added = next.filter((n) => !assignments.some((a) => a.channelId === n.channelId && a.personId === n.personId)).length;
    save.mutate(next);
    toast(added > 0 ? `Assigned ${added} mic${added === 1 ? "" : "s"}` : "Nothing to add. Every matching mic is already assigned.");
  }

  const toggle = () => { setOpen(!open); try { localStorage.setItem("coolservices.mics.open", open ? "0" : "1"); } catch { /* ignore */ } };

  return (
    <section className="border-b border-line px-6 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={toggle} className="flex items-center gap-2 text-sm font-semibold">
          <ChevronDown size={15} className={clsx("text-ink-muted transition", !open && "-rotate-90")} />
          <Mic size={15} className="text-accent" /> Mics &amp; packs
          <span className="font-normal text-ink-muted">{assignedCount}/{channels.length} assigned</span>
        </button>
        {hasIps && open && (
          <span className={clsx("flex items-center gap-1.5 text-[11px]", offline.length ? "text-warn" : "text-ink-faint")}>
            <span className={clsx("h-1.5 w-1.5 rounded-full", status.data ? (offline.length ? "bg-warn" : "bg-ok") : "bg-ink-faint")} />
            {!status.data ? "Connecting to receivers…" : offline.length ? `${offline.length} receiver${offline.length > 1 ? "s" : ""} not answering` : "Live from receivers · read-only"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {channels.some((c) => c.consoleInputs?.length) && <ConsoleSendButton planId={plan.id} />}
          <button className="btn-outline py-1 text-xs" onClick={runAuto} disabled={!channels.length || save.isPending}>
            <Sparkles size={13} /> Auto-assign
          </button>
          <button className="btn-ghost p-1.5" onClick={() => setEditing(true)} title="Set up mics"><Settings2 size={15} /></button>
        </div>
      </div>

      {open && (
        <div className="mt-3">
          {setup.isLoading || mics.isLoading ? <Skeleton className="h-24" /> : !channels.length ? (
            <div className="rounded-lg border border-dashed border-line p-4 text-sm text-ink-muted">
              No mics set up yet. <button className="text-accent underline" onClick={() => setEditing(true)}>Set up mics</button>
            </div>
          ) : (
            <div className="space-y-3">
              {(Object.keys(KIND) as MicKind[]).map((kind) => {
                const list = channels.filter((c) => c.kind === kind);
                if (!list.length) return null;
                const Icon = KIND[kind].icon;
                return (
                  <div key={kind}>
                    <div className="label mb-1.5 flex items-center gap-1.5"><Icon size={11} /> {KIND[kind].label}</div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                      {list.map((c) => {
                        const a = byChannel.get(c.id);
                        const rx = c.receiverId ? receivers.get(c.receiverId) : undefined;
                        const fits = people.filter((p) => fitsChannel(c, p));
                        const others = people.filter((p) => !fits.includes(p));
                        const person = a && people.find((p) => p.personId === a.personId);
                        const rs = rx ? rxStatus.get(rx.id) : undefined;
                        const live = rs?.ok ? rs.channels.find((x) => x.channel === c.channel) : undefined;
                        return (
                          <div key={c.id} className={clsx("rounded-lg border bg-raised p-2.5 transition",
                            live && live.batteryBars !== null && live.batteryBars <= 1 ? "border-bad/50"
                              : a ? "border-line" : "border-dashed border-line")}>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-ink">{c.label}</span>
                              <span className="text-ink-faint">{rx ? `${rx.name} · ${c.channel}` : "not linked"}</span>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              {person ? <Avatar name={person.name} src={person.avatarUrl} size={26} />
                                : <span className="grid h-[26px] w-[26px] place-items-center rounded-full border border-dashed border-line-strong text-ink-faint"><Icon size={12} /></span>}
                              <select value={a?.personId ?? ""}
                                onChange={(e) => setup.data && save.mutate(assignChannel(setup.data, assignments, c.id, people.find((p) => p.personId === e.target.value) ?? null))}
                                className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent py-1 text-[13px] text-ink hover:border-line focus:border-accent/60 focus:outline-none">
                                <option value="">Unassigned</option>
                                {fits.length > 0 && (
                                  <optgroup label={c.positions.join(" / ")}>
                                    {fits.map((p) => <option key={p.personId} value={p.personId}>{p.name}{p.confirmed ? "" : " (pending)"}</option>)}
                                  </optgroup>
                                )}
                                {others.length > 0 && (
                                  <optgroup label="Everyone serving">
                                    {others.map((p) => <option key={p.personId} value={p.personId}>{p.name} · {p.positions.join(", ")}</option>)}
                                  </optgroup>
                                )}
                              </select>
                            </div>
                            <div className="mt-2 min-h-[18px]">
                              {rx?.ip ? (rs && !rs.ok ? <span className="text-[10px] text-ink-faint">Receiver not answering</span>
                                : live ? <LiveStatus s={live} /> : <span className="text-[10px] text-ink-faint">Reading receiver…</span>)
                                : person ? <span className="text-[10px] text-ink-faint">{person.positions.join(" · ")}</span> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {editing && setup.data && (
        <MicSetupModal setup={setup.data} positions={[...new Set(plan.teams.flatMap((t) => t.positions.map((p) => p.name)))]}
          onClose={() => setEditing(false)} />
      )}
    </section>
  );
}

const hm = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`);

/** Battery · runtime · antennas · signal, as read from the receiver. */
export function LiveStatus({ s }: { s: ChannelStatus }) {
  if (!s.txOn) {
    return <div className="flex items-center gap-1.5 text-[10px] text-ink-faint"><span className="h-1.5 w-1.5 rounded-full bg-ink-faint" /> Transmitter off{s.name ? ` · ${s.name}` : ""}</div>;
  }
  const bars = s.batteryBars ?? 0;
  const tone = s.batteryBars === null ? "text-ink-muted" : bars <= 1 ? "text-bad" : bars === 2 ? "text-warn" : "text-ok";
  const ants = (s.antennas ?? "").split("");
  const rfStrength = s.rfDbm === null ? 0 : Math.max(0, Math.min(5, Math.round((s.rfDbm + 95) / 10))); // −95 dBm → 0 … −45 → 5
  return (
    <div className="flex items-center gap-2.5 text-[10px] tabular-nums">
      <span className={clsx("flex items-center gap-1", tone)} title={s.batteryType ? `Battery: ${s.batteryType}` : "Battery"}>
        <span className="relative flex h-2.5 w-5 items-center rounded-[2px] border border-current p-[1px] after:absolute after:-right-[3px] after:h-1 after:w-[2px] after:rounded-r after:bg-current">
          {Array.from({ length: 5 }, (_, i) => <span key={i} className={clsx("mr-[1px] h-full flex-1", i < bars ? "bg-current" : "bg-transparent")} />)}
        </span>
        {s.batteryMinutes !== null ? hm(s.batteryMinutes) : s.batteryPercent !== null ? `${s.batteryPercent}%` : `${bars}/5`}
      </span>
      {ants.length > 0 && (
        <span className="flex items-center gap-0.5" title="Antennas receiving">
          {ants.map((ch, i) => (
            <span key={i} className={clsx("rounded px-[3px] text-[9px] font-semibold", ch === "X" ? "bg-hover text-ink-faint" : "bg-accent-soft text-accent")}>
              {String.fromCharCode(65 + i)}
            </span>
          ))}
        </span>
      )}
      {s.rfDbm !== null && (
        <span className="flex items-end gap-[1px]" title={`RF ${s.rfDbm} dBm`}>
          {Array.from({ length: 5 }, (_, i) => <span key={i} style={{ height: 3 + i * 2 }} className={clsx("w-[2px] rounded-sm", i < rfStrength ? "bg-ink-soft" : "bg-line-strong")} />)}
        </span>
      )}
      {s.muted && <span className="flex items-center gap-0.5 text-warn"><MicOff size={10} /> Muted</span>}
      {s.interference && <span className="flex items-center gap-0.5 text-bad" title="Receiver reports RF interference"><AlertTriangle size={10} /> RF</span>}
      {s.frequencyMHz && <span className="ml-auto text-ink-faint">{s.frequencyMHz.toFixed(3)}</span>}
    </div>
  );
}
