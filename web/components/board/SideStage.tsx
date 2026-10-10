"use client";
/**
 * The mic board on the stage display: a photo card per mic, half of them down the left and half
 * down the right (in Mic setup order), and in the middle your logo over the clock.
 *
 *   ┌───────────────┐
 *   │    VOX 1 + AG │  ← the mic (and the same person's other mics, by name only), in the mic's color
 *   │ your line 80%▮│  ← your own line, and the card's own mic's battery with its percentage (Shure, read-only)
 *   │   [picture]   │  ← their background, or their Planning Center photo
 *   │     EDDIE     │
 *   └───────────────┘
 *
 * The middle: the time of day with the date under it, or the production clock's main timer with
 * the name of the timer (the preset) under it. Sized by its container, so the same board works full
 * screen and as the preview in the app.
 */
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_LABEL, DEFAULT_TIMER_COLOR, readClock, type ClockState, type ClockTone } from "@shared/clock";
import type { BoardTile, DisplayState, TileStatus } from "@shared/board";
import { useClockStream } from "@/components/clock/useClock";

export const BOARD_FONT = "'Barlow Condensed', 'DIN Condensed', 'Avenir Next Condensed', 'Roboto Condensed', 'Arial Narrow', sans-serif";
const BG = "#0E0E0F";
const CARD = "#161617";

/** How many cards per row fit k cards best in a w × h box (cards about 0.64 : 1). */
export function sideColumns(k: number, w: number, h: number) {
  let best = 1, bestW = 0;
  for (let c = 1; c <= Math.max(1, k); c++) {
    const rows = Math.ceil(k / c);
    const cw = Math.min(w / c, (h / rows) * 0.64);
    if (cw > bestW + 0.01) { bestW = cw; best = c; }
  }
  return best;
}

/** "#4ADE80" → rgba with alpha. */
const tint = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const BATTERY: Record<TileStatus, string> = { ok: "#4ADE80", low: "#FACC15", critical: "#EF4444", txoff: "#6B7280", offline: "#6B7280", noreceiver: "#6B7280" };

/**
 * The battery: Material Symbols' battery_android_0 (Google, Apache License 2.0) as the frame, filled to
 * the charge, with the percentage beside it like a phone's status bar. Shure reports a percentage for
 * rechargeable packs; with batteries that only report bars (0–5), it's the bars as a percentage.
 */
const FRAME = "M130-240q-37.5 0-63.75-26.25T40-330v-300q0-37.5 26.25-63.75T130-720h620q37.5 0 63.75 26.25T840-630v300q0 37.5-26.25 63.75T750-240H130Zm0-60h620q12.75 0 21.38-8.63Q780-317.25 780-330v-300q0-12.75-8.62-21.38Q762.75-660 750-660H130q-12.75 0-21.37 8.62Q100-642.75 100-630v300q0 12.75 8.63 21.37Q117.25-300 130-300Zm740-87v-186h20q12 0 21 9t9 21v126q0 12-9 21t-21 9h-20Z";
export function batteryPercent(percent: number | null, bars: number | null) {
  if (percent != null) return Math.max(0, Math.min(100, Math.round(percent)));
  return bars != null ? Math.max(0, Math.min(5, bars)) * 20 : null;
}
function Battery({ status, percent, bars, minutes, now, title }: {
  status: TileStatus; percent: number | null; bars: number | null; minutes: number | null; now: number; title: string;
}) {
  const on = status !== "txoff" && status !== "offline" && status !== "noreceiver";
  const pct = on ? batteryPercent(percent, bars) : null;
  const color = BATTERY[status];
  const flash = status === "critical" && Math.floor(now / 600) % 2 === 0;
  const fillW = pct != null ? Math.max(pct > 0 ? 50 : 0, (620 * pct) / 100) : 0;
  const words = `${title}: ${on ? `${pct ?? "?"}%${minutes != null ? ` · ${minutes} min left` : ""}` : status === "txoff" ? "transmitter off" : "receiver not answering"}`;
  return (
    <span className="flex h-full shrink-0 items-center" title={words} style={{ gap: "0.35em", opacity: flash ? 0.35 : 1, transition: "opacity .15s", height: "100%" }}>
      <span className="font-bold tabular-nums" style={{ fontSize: "1em", lineHeight: 1, color: on ? (status === "ok" ? "#F4F4F5" : color) : "#71717A", letterSpacing: "0.02em" }}>
        {on ? (pct != null ? `${pct}%` : "") : status === "txoff" ? "OFF" : "—"}
      </span>
      <svg viewBox="30 -730 900 500" className="block h-full shrink-0" role="img" aria-label={words}>
        <path d={FRAME} fill={on ? "#D4D4D8" : "#52525B"} />
        {on && fillW > 0 && <rect x={130} y={-630} width={fillW} height={300} rx={30} fill={color} />}
      </svg>
    </span>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

export function StageCard({ t, now, names }: { t: BoardTile; now: number; names: "first" | "full" }) {
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => { setBroken(null); }, [t.image]);
  const img = t.image && broken !== t.image ? t.image : null;
  const label = [t.micLabel, ...t.extras.map((x) => x.micLabel)].join(" + ");
  const name = t.person ? (names === "full" ? t.person.name : t.person.firstName) : null;
  // A battery to change now edges the card in flashing red (a low one only turns the battery yellow).
  const worst = t.status === "critical" ? "critical" : null;
  const flash = worst === "critical" && Math.floor(now / 600) % 2 === 0;
  const edge = worst ? BATTERY[worst] : "transparent";

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden [container-type:size]"
      style={{ background: CARD, borderRadius: 0, boxShadow: worst ? `inset 0 0 0 ${flash ? "0.3cqh" : "0.7cqh"} ${edge}` : undefined }}>
      {/* the mic (and their other mics), your line, and the battery: sizes in the header's own units */}
      <div className="relative flex shrink-0 flex-col [container-type:size]" style={{ height: "21cqh", background: tint(t.color, 0.16), color: t.color }}>
        <div className="flex items-end justify-center px-[5cqw] text-center" style={{ height: "50cqh", paddingBottom: "2cqh" }}>
          <span className="truncate font-bold uppercase" style={{ fontSize: label.length > 14 ? "26cqh" : "31cqh", letterSpacing: "0.05em", lineHeight: 1 }}>{label}</span>
        </div>
        {/* Your line on the left, the battery on the right (your line centered when there's no battery). */}
        <div className={clsx("relative flex items-center", t.networked ? "justify-start" : "justify-center")}
          style={{ height: "44cqh", paddingLeft: "5cqw", paddingRight: t.networked ? "52cqw" : "5cqw" }}>
          {t.text && <span className="min-w-0 truncate font-semibold uppercase" style={{ fontSize: "20cqh", letterSpacing: "0.08em", opacity: 0.85 }}>{t.text}</span>}
          {t.networked && (
            <span className="absolute flex items-center" style={{ right: "4cqw", top: "50%", height: "34cqh", transform: "translateY(-50%)", fontSize: "30cqh" }}>
              <Battery status={t.status} percent={t.battery?.percent ?? null} bars={t.battery?.bars ?? null} minutes={t.battery?.minutes ?? null} now={now} title={t.micLabel} />
            </span>
          )}
        </div>
      </div>

      {/* the picture */}
      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: "#1D1D1F" }}>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "50% 22%", opacity: t.status === "txoff" || t.status === "offline" ? 0.55 : 1 }} onError={() => setBroken(t.image)} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center font-bold" style={{ fontSize: "30cqh", color: tint(t.color, 0.22), background: `linear-gradient(180deg, ${tint(t.color, 0.08)}, transparent)` }}>
            {name ? initials(t.person!.name) : ""}
          </div>
        )}
        {t.muted && (
          <span className="absolute inset-x-0 bottom-0 truncate text-center font-bold uppercase" style={{ fontSize: "5.4cqh", padding: "0.8cqh 3cqw", letterSpacing: "0.06em", background: "rgba(239,68,68,.85)", color: "#0B0B0C" }}>Muted</span>
        )}
      </div>

      {/* who's on it */}
      <div className="flex shrink-0 items-center justify-center px-[4cqw] text-center" style={{ height: "12.5cqh" }}>
        <span className="truncate font-bold uppercase" style={{ fontSize: name && name.length > 12 ? "7.4cqh" : "9cqh", letterSpacing: "0.05em", color: name ? "#F4F4F5" : "#52525B", lineHeight: 1 }}>{name ?? "Open"}</span>
      </div>
    </div>
  );
}

function Side({ tiles, cols, now, names }: { tiles: BoardTile[]; cols: number; now: number; names: "first" | "full" }) {
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  // Cards keep their shape (0.64 : 1): as wide as the side allows, or as tall as the rows allow.
  const w = `min(calc((30cqw - ${cols - 1} * 0.5cqw) / ${cols}), calc((92cqh - ${rows - 1} * 0.5cqw) / ${rows} * 0.64))`;
  return (
    <div className="flex h-full shrink-0 items-center justify-center" style={{ width: "30.5cqw" }}>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, ${w})`, gap: "0.5cqw" }}>
        {tiles.map((t) => <div key={t.channelId} style={{ aspectRatio: "0.64 / 1" }}><StageCard t={t} now={now} names={names} /></div>)}
      </div>
    </div>
  );
}

const two = (t: string) => t.replace(/^(\+?)(\d):(\d\d)$/, (_m, sign: string, m: string, sec: string) => `${sign}0${m}:${sec}`);
function toneColor(tone: ClockTone, base: string) {
  return tone === "warn" ? "#FACC15" : tone === "danger" || tone === "over" ? "#EF4444" : tone === "idle" ? "#6B7280" : base;
}

/** The time of day: 10:37 with the seconds small beside it, and the date under it. */
function TimeOfDay({ now, seconds, date }: { now: number; seconds: boolean; date: boolean }) {
  const d = new Date(now);
  const hm = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
  return (
    <>
      <div className="flex items-start justify-center tabular-nums" style={{ lineHeight: 0.9 }}>
        <span className="font-bold" style={{ fontSize: "14cqh", letterSpacing: "-0.01em" }}>{hm}</span>
        {seconds && <span className="font-semibold" style={{ fontSize: "4.8cqh", color: "#6B7280", marginLeft: "0.3cqw", marginTop: "1cqh", width: "2.2em" }}>{String(d.getSeconds()).padStart(2, "0")}</span>}
      </div>
      {date && <div className="font-semibold uppercase" style={{ fontSize: "2.5cqh", letterSpacing: "0.14em", color: "#8B8B92", marginTop: "0.5cqh" }}>{d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>}
    </>
  );
}

/** The production clock's main timer, and under it which timer it is (the preset you loaded). */
export function productionLabel(state: ClockState) {
  const label = state.main.idle || (state.main.label && state.main.label !== DEFAULT_LABEL[state.main.mode] ? state.main.label : "");
  const preset = state.presetName ?? "";
  if (preset && label && label.toLowerCase() !== preset.toLowerCase()) return `${preset} · ${label}`;
  return preset || label || state.info?.title || DEFAULT_LABEL[state.main.mode];
}
function Production({ seconds }: { seconds: boolean }) {
  const { out, now } = useClockStream("/api/clock-out", 10);
  if (!out) return <TimeOfDay now={Date.now()} seconds={seconds} date={false} />;
  const st = out.state;
  const r = readClock(st.main, now, st.warnSec, st.dangerSec);
  const text = st.blank ? "--:--" : two(r.text);
  const base = st.timerColor && st.timerColor.toUpperCase() !== DEFAULT_TIMER_COLOR ? st.timerColor : "#FFFFFF";
  const pulse = r.tone === "over" && Math.floor(now / 500) % 2 === 0;
  return (
    <>
      <div className="font-bold tabular-nums" style={{ fontSize: text.length > 8 ? "10cqh" : text.length > 5 ? "12cqh" : "14cqh", lineHeight: 0.9, color: toneColor(r.tone, base), opacity: pulse ? 0.45 : 1, transition: "color .3s" }}>{text}</div>
      <div className="flex items-center justify-center font-semibold uppercase" style={{ fontSize: "2.5cqh", letterSpacing: "0.14em", color: "#A1A1AA", marginTop: "0.6cqh", gap: "0.7cqw" }}>
        <span className="block rounded-full" style={{ width: "0.9cqh", height: "0.9cqh", background: st.main.running ? "#EF4444" : "#52525B" }} />
        <span className="max-w-[34cqw] truncate">{productionLabel(st)}</span>
      </div>
    </>
  );
}

function Center({ s, now }: { s: DisplayState; now: number }) {
  const c = s.settings.center;
  const plot = s.settings.plot;
  return (
    <div className={clsx("flex h-full min-w-0 flex-1 flex-col items-center text-white", plot ? "justify-start" : "justify-center")}
      style={plot ? { padding: "6cqh 1.5cqw 3cqh" } : { paddingBottom: "8cqh" }}>
      {c.logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.logo} alt="" className="shrink-0 object-contain" style={{ maxHeight: "8cqh", maxWidth: "16cqw", marginBottom: "2.2cqh" }} />
      )}
      <div className="shrink-0 text-center">
        {c.clock === "production" ? <Production seconds={c.seconds} /> : <TimeOfDay now={now} seconds={c.seconds} date={c.date} />}
      </div>
      {/* The stage plot: whatever room is left under the clock. A white page can show dark (inverted, colors kept). */}
      {plot && (
        <div className="relative mt-[3cqh] min-h-0 w-full flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={plot.url} alt="Stage plot" className="absolute inset-0 h-full w-full object-contain"
            style={plot.dark ? { filter: "invert(1) hue-rotate(180deg)", mixBlendMode: "screen" } : undefined} />
        </div>
      )}
    </div>
  );
}

export function SideStage({ s, now }: { s: DisplayState; now: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(16 / 9);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => el.clientHeight && setRatio(el.clientWidth / el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const half = Math.ceil(s.tiles.length / 2);
  const left = s.tiles.slice(0, half), right = s.tiles.slice(half);
  // Both sides use the same card size, set by the bigger side.
  const cols = s.settings.columns || sideColumns(half, 30 * ratio, 92);
  return (
    <div ref={ref} className="absolute inset-0 flex items-stretch [container-type:size]" style={{ background: BG, fontFamily: BOARD_FONT, padding: "0 0.6cqw" }}>
      <Side tiles={left} cols={cols} now={now} names={s.settings.names} />
      <Center s={s} now={now} />
      <Side tiles={right} cols={cols} now={now} names={s.settings.names} />
      {s.tiles.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[6cqh] text-center" style={{ color: "#52525B", fontSize: "2.6cqh" }}>
          No mics on the board yet. Add them in Settings → Mic setup.
        </div>
      )}
    </div>
  );
}
