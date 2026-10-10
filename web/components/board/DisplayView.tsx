"use client";
/**
 * The stage display as it appears on a TV / stage screen / second display: the banner across the
 * top (your message or mission statement, if it's on), then the mic board or the clock.
 * Sized by its container, so the same thing works full screen and as a preview in the app.
 */
import { useEffect, useRef, useState } from "react";
import type { BoardTile, DisplayState } from "@shared/board";
import { ClockFace } from "@/components/clock/ClockFace";
import { useClockStream } from "@/components/clock/useClock";
import type { TileHistory } from "./MicBoard";
import { SideStage } from "./SideStage";

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

function ClockView() {
  const { out, now } = useClockStream("/api/clock-out", 10);
  if (!out) return <div className="h-full w-full bg-black" />;
  return <ClockFace state={out.state} now={now} showTimeOfDay={out.showTimeOfDay} title={out.title} infoHeading={out.infoHeading} />;
}

export function DisplayView({ s, now }: { s: DisplayState; now: number }) {
  const [ref] = useSize<HTMLDivElement>();
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-black text-white [container-type:size]" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif" }}>
      <Banner s={s} now={now} />
      <div ref={ref} className="relative min-h-0 flex-1" style={{ padding: 0 }}>
        {s.view === "micboard" && <SideStage s={s} now={now} />}
        {s.view === "clock" && <ClockView />}
      </div>
    </div>
  );
}
