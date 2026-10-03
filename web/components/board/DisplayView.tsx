"use client";
/**
 * The stage display as it appears on a TV / stage screen / second display: the banner across the
 * top (your message or mission statement), then the mic board, the stage plot or the clock.
 * Sized by its container, so the same thing works full screen and as a preview in the app.
 */
import { useEffect, useRef, useState } from "react";
import type { DisplayState } from "@shared/board";
import type { MicAssignment, MicChannel, PlanDetail, PlotItem } from "@shared/types";
import { peopleForPlan } from "@/lib/stage";
import { ClockFace } from "@/components/clock/ClockFace";
import { useClockStream } from "@/components/clock/useClock";
import { PlotCanvas } from "@/components/stage/PlotCanvas";
import { MicGrid } from "./MicBoard";

const BANNER_H = { s: 7, m: 10, l: 14 } as const;

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 1600, h: 900 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function Banner({ s, now }: { s: DisplayState; now: number }) {
  const b = s.settings.banner;
  if (!b.enabled) return null;
  const h = BANNER_H[b.size];
  const side = { fontSize: `${h * 0.32}cqh`, opacity: 0.8, whiteSpace: "nowrap" as const };
  return (
    <div className="flex shrink-0 items-center overflow-hidden" style={{ height: `${h}cqh`, background: b.background, color: b.color, padding: "0 2cqw", gap: "2cqw" }}>
      {b.showService && s.service && (
        <div style={side}><b>{s.service.serviceTypeName}</b>{s.service.nextTime ? ` · ${s.service.nextTime}` : ""}</div>
      )}
      <div className="relative min-w-0 flex-1 overflow-hidden" style={{ height: "100%" }}>
        {b.text && (b.scroll ? (
          <div className="absolute inset-y-0 flex items-center whitespace-nowrap font-bold" style={{ fontSize: `${h * 0.52}cqh`, animation: `cs-marquee ${Math.max(12, b.text.length * 0.28)}s linear infinite`, paddingLeft: "100%" }}>{b.text}</div>
        ) : (
          <div className="flex h-full items-center justify-center text-center font-bold" style={{ fontSize: `${h * (b.text.length > 70 ? 0.36 : 0.5)}cqh`, lineHeight: 1.1 }}>{b.text}</div>
        ))}
      </div>
      {b.showClock && <div className="tabular-nums" style={{ ...side, fontWeight: 700, opacity: 1, fontSize: `${h * 0.42}cqh` }}>{new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>}
      <style>{`@keyframes cs-marquee { from { transform: translateX(0) } to { transform: translateX(-100%) } }`}</style>
    </div>
  );
}

function StageView({ s }: { s: DisplayState }) {
  const st = s.stage;
  if (!st?.plot) return <Empty text="No stage plot for this service yet. Make one in Stage plots and set it as the default for this service type." />;
  const plot = st.plot;
  const bg = plot.background;
  const ratio = bg ? bg.width / bg.height : 16 / 10;
  const plan = { roster: st.roster } as unknown as PlanDetail;
  const people = peopleForPlan(plot.items as PlotItem[], plan, st.assignments as MicAssignment[], st.channels as MicChannel[]);
  const micLabels = new Map(st.channels.map((c) => [c.id, c.label]));
  return (
    <div className="flex h-full w-full items-center justify-center [container-type:size]" style={{ padding: "1.5cqh 1.5cqw" }}>
      <div style={{ width: `min(100cqw, calc(100cqh * ${ratio}))` }}>
        <PlotCanvas plot={{ background: bg ? { fileId: "", width: bg.width, height: bg.height, source: "" } : null, items: plot.items as PlotItem[] }}
          backgroundUrl={bg?.url} people={people} micLabels={micLabels} />
      </div>
    </div>
  );
}

function ClockView() {
  const { out, now } = useClockStream("/api/clock-out", 10);
  if (!out) return <div className="h-full w-full bg-black" />;
  return <ClockFace state={out.state} now={now} showTimeOfDay={out.showTimeOfDay} title={out.title} infoHeading={out.infoHeading} />;
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full w-full items-center justify-center p-[4cqw] text-center text-white/60" style={{ fontSize: "3cqh" }}>{text}</div>;
}

export function DisplayView({ s, now }: { s: DisplayState; now: number }) {
  const [ref, size] = useSize<HTMLDivElement>();
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-black text-white [container-type:size]" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif" }}>
      <Banner s={s} now={now} />
      <div ref={ref} className="relative min-h-0 flex-1" style={{ padding: s.view === "micboard" ? "1.2cqh 1cqw" : 0 }}>
        {s.view === "micboard" && (s.tiles.length
          ? <MicGrid tiles={s.tiles} columns={s.settings.columns} now={now} width={size.w} height={size.h} />
          : <Empty text="No mics to show. Set up your receivers and mics in Services → a service → Mics → Set up mics." />)}
        {s.view === "stageplot" && <StageView s={s} />}
        {s.view === "clock" && <ClockView />}
      </div>
    </div>
  );
}
