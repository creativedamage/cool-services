"use client";
/**
 * The stage display as it appears on a TV / stage screen / second display: the banner across the
 * top (your message or mission statement), then the mic board, the stage plot or the clock.
 * Sized by its container, so the same thing works full screen and as a preview in the app.
 */
import { useEffect, useRef, useState } from "react";
import type { BoardTile, DisplayState } from "@shared/board";
import type { MicAssignment, MicChannel, PlanDetail, PlotItem } from "@shared/types";
import { peopleForPlan } from "@/lib/stage";
import { ClockFace } from "@/components/clock/ClockFace";
import { useClockStream } from "@/components/clock/useClock";
import { PlotCanvas } from "@/components/stage/PlotCanvas";
import type { TileHistory } from "./MicBoard";

/** Recent audio and RF readings per mic (kept on this screen) for the graphs; `at` changes with new readings. */
export function useTileHistory(tiles: BoardTile[], at: string) {
  const ref = useRef(new Map<string, TileHistory>());
  const last = useRef("");
  if (at !== last.current) {
    last.current = at;
    for (const t of tiles) {
      const h = ref.current.get(t.channelId) ?? { audio: [], rf: [] };
      h.audio = [...h.audio, t.audio ?? 0].slice(-40);
      h.rf = [...h.rf, t.rf?.dbm != null ? Math.max(0, t.rf.dbm + 100) : 0].slice(-40);
      ref.current.set(t.channelId, h);
    }
  }
  return ref.current;
}

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

/**
 * The mic board is Micboard itself (creativedamage/micboard, running inside Cool Services on this
 * Mac): its own page, from the same computer this page came from, at Micboard's port.
 */
function MicboardFrame({ s }: { s: DisplayState }) {
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => { setHost(`${location.protocol}//${location.hostname}`); }, []);
  const m = s.micboard;
  if (!m) return <Empty text="Micboard is off. Turn it on in Preferences → Micboard." />;
  if (!m.running) return <Empty text={m.error ?? "Starting Micboard…"} />;
  if (!host) return null;
  const src = `${host}:${m.port}/${m.hash}`;
  // A new hash or new background pictures load Micboard's page again (it reads them when it opens).
  return <iframe key={`${src}|${m.rev}`} src={src} title="Micboard" className="absolute inset-0 h-full w-full border-0 bg-black" allow="fullscreen" />;
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full w-full items-center justify-center p-[4cqw] text-center text-white/60" style={{ fontSize: "3cqh" }}>{text}</div>;
}

export function DisplayView({ s, now }: { s: DisplayState; now: number }) {
  const [ref] = useSize<HTMLDivElement>();
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-black text-white [container-type:size]" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif" }}>
      <Banner s={s} now={now} />
      <div ref={ref} className="relative min-h-0 flex-1" style={{ padding: 0 }}>
        {s.view === "micboard" && <MicboardFrame s={s} />}
        {s.view === "stageplot" && <StageView s={s} />}
        {s.view === "clock" && <ClockView />}
      </div>
    </div>
  );
}
