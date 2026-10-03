"use client";
/**
 * The FOH companion's mic strip: one short tile per mic in a row across the bottom of the screen.
 *
 *   ┌ HH01 ············· Mollie ┐  ← status color (orange low battery, red change it, striped when the
 *   │ ▮▮▮▯▯                     │     transmitter is off or the receiver can't be reached)
 *   │                    18 dB  │  ← audio level and its recent graph
 *   │ ~~~~~~~~~~~~~~~~~~~~~~~~~ │
 *   │ ●●●○○        501.500 MHz  │  ← RF strength and frequency, and the RF graph
 *   │ ~~~~~~~~~~~~~~~~~~~~~~~~~ │
 *   └ ▬▬▬▬▬▬▬▬▬▬ ▬▬▬▬▬▬▬▬▬▬▬▬ ┘  ← antennas A / B
 */
import type { BoardTile, TileStatus } from "@shared/board";
import type { TileHistory } from "./MicBoard";

const HEAD: Record<TileStatus, string> = {
  ok: "#5DAE5F", low: "#E8913A", critical: "#D9372E", txoff: "#B3261E", offline: "#8A5A2B", noreceiver: "#4A4A4A",
};
const BODY = "#222222";
const LINE = "#3A3A3A";
const rfBars = (dbm: number | null) => (dbm == null ? 0 : dbm >= -60 ? 5 : dbm >= -67 ? 4 : dbm >= -75 ? 3 : dbm >= -82 ? 2 : dbm >= -90 ? 1 : 0);

function Spark({ values, max, color }: { values: number[]; max: number; color: string }) {
  if (values.length < 2) return null;
  const n = 40;
  const v = values.slice(-n);
  const pts = v.map((x, i) => `${((i + n - v.length) / (n - 1)) * 100},${100 - Math.max(0, Math.min(1, x / max)) * 80 - 10}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function StripTile({ t, now, history }: { t: BoardTile; now: number; history?: TileHistory }) {
  const offNet = !t.networked;
  const color = offNet ? HEAD.noreceiver : t.muted && t.status === "ok" ? "#0F5A8C" : HEAD[t.status];
  const striped = !offNet && (t.status === "txoff" || t.status === "offline");
  const flash = t.status === "critical" && Math.floor(now / 700) % 2 === 0;
  const bars = t.battery?.bars ?? null;
  const ants = (t.rf?.antennas ?? "").padEnd(2, "X").slice(0, 2).split("");
  const head: React.CSSProperties = striped
    ? { background: `repeating-linear-gradient(120deg, ${color} 0 9cqw, #2B1A17 9cqw 18cqw)` }
    : { background: color, opacity: flash ? 0.6 : 1, transition: "opacity .2s" };
  const name = t.person?.firstName ?? "";
  const small = { fontSize: "min(9cqh, 6cqw)" } as const;

  return (
    <div className="relative h-full min-w-0 flex-1 [container-type:size]">
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ background: BODY, borderRadius: "7cqh 7cqh 2cqh 2cqh", fontFamily: "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif" }}>
      {/* mic · who */}
      <div className="flex shrink-0 items-center gap-[2cqw] px-[4cqw]" style={{ height: "22cqh", ...head }} title={t.note ?? undefined}>
        <span className="truncate italic" style={{ fontSize: "min(13cqh, 8.5cqw)", fontWeight: 300, color: "#F2F2F2" }}>{t.micLabel}</span>
        {t.extras.map((x) => (
          <span key={x.channelId} className="shrink-0 rounded-full px-[2cqw] italic" title={x.networked ? x.note ?? "" : "Not on the network"}
            style={{ fontSize: "min(8cqh, 5cqw)", color: "#F2F2F2", background: "rgba(0,0,0,.35)", border: `0.6cqh solid ${x.networked ? HEAD[x.status] : "#777"}` }}>+{x.micLabel}</span>
        ))}
        <span className="ml-auto truncate" style={{ fontSize: "min(13cqh, 8.5cqw)", color: t.person ? "#F2F2F2" : "rgba(255,255,255,.55)" }}>{t.person ? name : "—"}</span>
      </div>

      {offNet ? (
        <div className="flex flex-1 items-center justify-center text-center" style={{ ...small, color: "#8A8A8A", borderTop: `0.8cqh solid ${LINE}` }}>
          Not on the network
        </div>
      ) : (<>
        {/* battery */}
        <div className="flex shrink-0" style={{ height: "8cqh", borderBottom: `0.6cqh solid ${LINE}` }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="block flex-1" style={{ background: bars != null && i <= bars ? color : "#1A1A1A", borderLeft: i > 1 ? `0.6cqh solid ${LINE}` : undefined }} />
          ))}
        </div>
        {/* audio */}
        <div className="flex shrink-0 justify-end px-[2.5cqw] font-mono italic" style={{ height: "10cqh", ...small, color: "#3F7A44", lineHeight: 1.1, paddingTop: "1cqh" }}>
          {t.note && t.status !== "ok" ? <span className="mr-auto not-italic font-sans font-semibold uppercase" style={{ color: HEAD[t.status] === "#4A4A4A" ? "#999" : HEAD[t.status] }}>{t.muted ? "Muted" : t.note}</span> : null}
          {t.audio != null && `${t.audio - 50} dB`}
        </div>
        <div className="min-h-0 flex-1 px-[0.5cqw]">{t.audio != null && <Spark values={history?.audio ?? []} max={50} color="#62C46A" />}</div>
        {/* RF */}
        <div className="flex shrink-0 items-center justify-between px-[2.5cqw]" style={{ height: "10cqh" }}>
          <span className="flex" style={{ gap: "1cqw" }}>
            {t.rf && [1, 2, 3, 4, 5].map((i) => (
              <span key={i} className="block rounded-full" style={{ width: "min(7cqh, 4.5cqw)", height: "min(7cqh, 4.5cqw)", border: "0.6cqh solid #7A5470", background: i <= rfBars(t.rf?.dbm ?? null) ? "#7A5470" : "transparent" }} />
            ))}
          </span>
          <span className="font-mono italic" style={{ ...small, color: "#7A2E2A" }}>{t.frequencyMHz != null ? `${t.frequencyMHz.toFixed(3)} MHz` : ""}</span>
        </div>
        <div className="min-h-0 flex-1 px-[0.5cqw]">{t.rf && <Spark values={history?.rf ?? []} max={70} color="#E0392E" />}</div>
        {/* antennas */}
        <div className="flex shrink-0" style={{ height: "7cqh", borderTop: `0.6cqh solid ${LINE}` }}>
          {ants.map((a, i) => (
            <span key={i} className="block flex-1" style={{ background: t.rf && a !== "X" && a !== "-" ? "#155E92" : "#1A1A1A", borderLeft: i ? `0.6cqh solid ${LINE}` : undefined }} />
          ))}
        </div>
      </>)}
    </div>
    </div>
  );
}

/** All the mics in one row, filling the width. */
export function MicStripRow({ tiles, now, history }: { tiles: BoardTile[]; now: number; history?: Map<string, TileHistory> }) {
  return (
    <div className="flex h-full w-full" style={{ gap: "max(4px, 0.45vw)" }}>
      {tiles.map((t) => <StripTile key={t.channelId} t={t} now={now} history={history?.get(t.channelId)} />)}
    </div>
  );
}
