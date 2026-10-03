"use client";
/**
 * The mic board, laid out like Micboard: a tall dark column per wireless mic.
 *
 *   VOX 1            ← the mic (italic)
 *   [picture]        ← behind the name, or a round Planning Center photo above it, or nothing
 *   Priya            ← who's on it this service
 *   ██████████████   ← status block: green fine, yellow low battery, red change it / RF trouble,
 *                       striped when the transmitter is off or the receiver can't be reached
 *   ▮▮▮▯▯            ← battery
 *   -12 dB  ~~~~~~   ← audio level and its recent history
 *   ●●●○○ 554.125    ← RF strength and frequency
 *   ~~~~~~           ← RF history
 *   ▬▬ ▬▬            ← antennas A / B
 */
import { useEffect, useState } from "react";
import type { BoardTile, TileStatus } from "@shared/board";

export type TileHistory = { audio: number[]; rf: number[] };

const COLOR: Record<TileStatus, string> = {
  ok: "#4CAF50", low: "#E8B931", critical: "#D9372E", txoff: "#D9372E", offline: "#6B7280", noreceiver: "#3A3A3A",
};
const BG = "#262626";
const LINE = "#3A3A3A";
const rfBars = (dbm: number | null) => (dbm == null ? 0 : dbm >= -60 ? 5 : dbm >= -67 ? 4 : dbm >= -75 ? 3 : dbm >= -82 ? 2 : dbm >= -90 ? 1 : 0);
const runTime = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : `${m}m`);

/** How many columns fit n tall tiles best in a w×h box. */
export function bestColumns(n: number, w: number, h: number) {
  let best = 1, bestSize = 0;
  for (let c = 1; c <= Math.max(1, n); c++) {
    const rows = Math.ceil(n / c);
    const size = Math.min(w / c, (h / rows) * 0.32); // tiles about 1 : 3
    if (size > bestSize) { bestSize = size; best = c; }
  }
  return best;
}

/** A small line graph of recent values (0..max), drawn across the tile. */
function Spark({ values, max, color }: { values: number[]; max: number; color: string }) {
  if (values.length < 2) return <div className="h-full w-full" />;
  const n = 40;
  const v = values.slice(-n);
  const pts = v.map((x, i) => `${((i + n - v.length) / (n - 1)) * 100},${100 - Math.max(0, Math.min(1, x / max)) * 90 - 5}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function MicTile({ t, now, style, history }: { t: BoardTile; now: number; style: "background" | "icon" | "none"; history?: TileHistory }) {
  const color = COLOR[t.status];
  const striped = t.status === "txoff" || t.status === "offline" || t.status === "noreceiver";
  const flash = t.status === "critical" && Math.floor(now / 700) % 2 === 0;
  const bars = t.battery?.bars ?? null;
  // A picture that doesn't load (offline, removed in Planning Center) counts as no picture.
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => { setBroken(null); }, [t.image]);
  const showImg = style !== "none" && t.image && broken !== t.image;
  const nameColor = t.person ? "#ECECEC" : "#7A7A7A";
  const block: React.CSSProperties = striped
    ? { background: `repeating-linear-gradient(135deg, ${color}66 0 7cqw, ${BG} 7cqw 14cqw)` }
    : { background: color, opacity: flash ? 0.55 : 1, transition: "opacity .2s" };
  const ants = (t.rf?.antennas ?? "").padEnd(2, "X").slice(0, 2).split("");
  const audioDb = t.audio != null ? t.audio - 50 : null;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden [container-type:size]" style={{ background: BG, borderRadius: "1.2cqh" }}>
      {/* picture behind the top of the tile */}
      {showImg && style === "background" && (
        <div className="absolute inset-x-0 top-0" style={{ height: "57cqh" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={t.image!} alt="" className="h-full w-full object-cover" style={{ opacity: striped ? 0.35 : 0.85 }}
            onError={() => setBroken(t.image)} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(38,38,38,.85) 0%, rgba(38,38,38,0) 22%, rgba(38,38,38,0) 55%, rgba(38,38,38,.9) 100%)" }} />
        </div>
      )}

      {/* mic */}
      <div className="relative text-center" style={{ height: "9cqh", paddingTop: "1.2cqh" }}>
        <span className="block truncate px-[4cqw] italic" style={{ fontSize: "min(5.6cqh, 19cqw)", fontWeight: 300, color: "#E6E6E6", letterSpacing: "0.02em" }}>{t.micLabel}</span>
      </div>

      {/* person */}
      <div className="relative flex flex-col items-center justify-center px-[5cqw] text-center" style={{ height: "48cqh", gap: "2cqh" }}>
        {showImg && style === "icon" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.image!} alt="" className="rounded-full object-cover" style={{ width: "min(62cqw, 24cqh)", height: "min(62cqw, 24cqh)", border: `0.5cqh solid ${LINE}`, opacity: striped ? 0.45 : 1 }}
            onError={() => setBroken(t.image)} />
        )}
        <span className="max-w-full break-words" style={{
          fontSize: `min(${t.person && t.person.name.length > 12 ? 3.2 : 3.8}cqh, 15cqw)`, color: nameColor, lineHeight: 1.15,
          fontWeight: showImg && style === "background" ? 600 : 400, textShadow: showImg && style === "background" ? "0 0.3cqh 1cqh rgba(0,0,0,.9)" : undefined,
          marginTop: showImg && style === "background" ? "auto" : undefined, marginBottom: showImg && style === "background" ? "2cqh" : undefined,
        }}>
          {t.person ? t.person.name : "Unassigned"}
        </span>
      </div>

      {/* status block */}
      <div className="relative flex items-center justify-center" style={{ height: "14cqh", ...block }}>
        {(t.note || t.muted) && (
          <span className="text-center font-semibold uppercase" style={{ fontSize: "min(2.2cqh, 9cqw)", color: striped ? "#E6E6E6" : "#1A1A1A", letterSpacing: "0.06em", lineHeight: 1.2 }}>
            {t.muted ? "Muted" : t.note}
          </span>
        )}
      </div>

      {/* battery */}
      <div className="relative flex" style={{ height: "3cqh", borderTop: `0.15cqh solid ${LINE}`, borderBottom: `0.15cqh solid ${LINE}` }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="block flex-1" style={{ background: bars != null && i <= bars ? (striped ? "#555" : color) : "transparent", borderLeft: i > 1 ? `0.15cqh solid ${LINE}` : undefined }} />
        ))}
      </div>

      {/* audio */}
      <div className="relative flex justify-end px-[3cqw] font-mono italic" style={{ height: "3.5cqh", fontSize: "min(1.9cqh, 7.5cqw)", color: "#3F7A44", paddingTop: "0.6cqh" }}>
        {t.battery?.minutes != null && <span className="mr-auto not-italic" style={{ color: "#8A8A8A" }}>{runTime(t.battery.minutes)}</span>}
        {audioDb != null && `${audioDb} dB`}
      </div>
      <div className="relative px-[1.5cqw]" style={{ height: "8cqh" }}>{t.audio != null && <Spark values={history?.audio ?? []} max={50} color="#5FBF66" />}</div>

      {/* RF */}
      <div className="relative flex items-center justify-between px-[3cqw]" style={{ height: "3.5cqh" }}>
        <span className="flex" style={{ gap: "0.8cqw" }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="block rounded-full" style={{ width: "min(1.6cqh, 6cqw)", height: "min(1.6cqh, 6cqw)", border: "0.2cqh solid #6E4B63", background: i <= rfBars(t.rf?.dbm ?? null) ? "#6E4B63" : "transparent" }} />
          ))}
        </span>
        <span className="font-mono italic" style={{ fontSize: "min(1.9cqh, 7.5cqw)", color: "#6B2E2A" }}>{t.frequencyMHz != null ? `${t.frequencyMHz.toFixed(3)} MHz` : ""}</span>
      </div>
      <div className="relative px-[1.5cqw]" style={{ height: "7.5cqh" }}>{t.rf && <Spark values={history?.rf ?? []} max={70} color="#D9372E" />}</div>

      {/* antennas */}
      <div className="relative mt-auto flex" style={{ height: "3cqh", borderTop: `0.15cqh solid ${LINE}` }}>
        {ants.map((a, i) => (
          <span key={i} className="block flex-1" style={{ background: a !== "X" && a !== "-" && t.rf ? "#155E92" : "transparent", borderLeft: i ? `0.15cqh solid ${LINE}` : undefined }} />
        ))}
      </div>
    </div>
  );
}

/** All the tiles, filling the box they're in (no scrolling on a TV). */
export function MicGrid({ tiles, columns, now, width, height, style, history }: {
  tiles: BoardTile[]; columns: number; now: number; width: number; height: number; style: "background" | "icon" | "none"; history?: Map<string, TileHistory>;
}) {
  const cols = columns || bestColumns(tiles.length, width, height);
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  return (
    <div className="grid h-full w-full" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, gap: "max(4px, 0.5vmin)" }}>
      {tiles.map((t) => <MicTile key={t.channelId} t={t} now={now} style={style} history={history?.get(t.channelId)} />)}
    </div>
  );
}
