"use client";
/** Dashboard widget: the production clock with start/pause, reset, next, and the saved timers. */
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronRight, Pause, Play, RotateCcw, Timer } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Api } from "@/lib/api";
import { Frame } from "@/components/dashboard/Widgets";
import { ClockFace } from "./ClockFace";
import { useClockStream } from "./useClock";

export function ProdClockWidget() {
  const { out, now } = useClockStream("/api/clock-out", 5);
  const view = useQuery({ queryKey: ["clock"], queryFn: Api.clock, refetchInterval: 15_000 });
  const act = useMutation({ mutationFn: Api.clockAction, onError: (e) => toast.error("The clock didn’t take that", { description: (e as Error).message }) });
  const s = out?.state;
  const running = Boolean(s?.main.running && s.main.startedAt);
  return (
    <Frame title="Production clock" icon={Timer} right={<Link href="/clock" className="text-xs text-accent hover:underline">Open</Link>}>
      {s ? (
        <>
          <div className="overflow-hidden rounded-lg" style={{ aspectRatio: "16 / 9" }}><ClockFace state={s} now={now} showTimeOfDay={out?.showTimeOfDay} title={out?.title} infoHeading={out?.infoHeading} /></div>
          <div className="mt-2 flex items-center gap-1">
            <button className={clsx("btn-primary py-1 text-xs", running && "bg-warn")} onClick={() => act.mutate({ type: "toggle" })}>{running ? <Pause size={13} /> : <Play size={13} />}{running ? "Pause" : "Start"}</button>
            <button className="btn-ghost p-1.5" title="Reset" onClick={() => act.mutate({ type: "reset" })}><RotateCcw size={13} /></button>
            <button className="btn-ghost p-1.5" title="Next timer" onClick={() => act.mutate({ type: "next" })}><ChevronRight size={14} /></button>
            <button className="btn-ghost px-1.5 py-1 text-xs" onClick={() => act.mutate({ type: "add", sec: 60 })}>+1m</button>
          </div>
          {Boolean(view.data?.presets.length) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {view.data!.presets.slice(0, 8).map((p) => (
                <button key={p.id} onClick={() => act.mutate({ type: "load", presetId: p.id, start: true })}
                  className={clsx("rounded-md border px-2 py-0.5 text-[11px]", s.presetId === p.id ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-soft hover:border-line-strong")}
                  style={{ borderLeftColor: p.color, borderLeftWidth: 3 }}>{p.name}</button>
              ))}
            </div>
          )}
        </>
      ) : <div className="h-24" />}
    </Frame>
  );
}
