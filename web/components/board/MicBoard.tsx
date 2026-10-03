"use client";
/**
 * The mic board: a tile per wireless mic with the person's picture, name, battery, RF and audio, in
 * the spirit of Micboard. Colors: green fine, yellow low battery, red change the battery / RF
 * interference, grey transmitter off or receiver offline.
 */
import clsx from "clsx";
import type { BoardTile, TileStatus } from "@shared/board";

const STATUS: Record<TileStatus, { color: string; label: string }> = {
  ok: { color: "#22C55E", label: "" },
  low: { color: "#EAB308", label: "LOW BATTERY" },
  critical: { color: "#EF4444", label: "" },
  txoff: { color: "#4B5563", label: "TX OFF" },
  offline: { color: "#6B7280", label: "RECEIVER OFFLINE" },
  noreceiver: { color: "#334155", label: "" },
};

const rfBars = (dbm: number | null) => (dbm == null ? 0 : dbm >= -60 ? 5 : dbm >= -67 ? 4 : dbm >= -75 ? 3 : dbm >= -82 ? 2 : dbm >= -90 ? 1 : 0);
const runTime = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : `${m}m`);

/** How many columns fit n tiles best in a w×h box (tiles about 4:5). */
export function bestColumns(n: number, w: number, h: number) {
  let best = 1, bestSize = 0;
  for (let c = 1; c <= Math.max(1, n); c++) {
    const rows = Math.ceil(n / c);
    const tw = w / c, th = h / rows;
    const size = Math.min(tw, th * 0.8); // tile width limited by height at 4:5
    if (size > bestSize) { bestSize = size; best = c; }
  }
  return best;
}

export function MicTile({ t, now }: { t: BoardTile; now: number }) {
  const st = STATUS[t.status];
  const dim = t.status === "txoff" || t.status === "offline";
  const pulse = t.status === "critical" && Math.floor(now / 600) % 2 === 0;
  const bars = t.battery?.bars ?? null;
  return (
    <div className="relative h-full w-full overflow-hidden [container-type:size]"
      style={{ borderRadius: "3cqmin", background: "#0B0F17", boxShadow: `inset 0 0 0 0.9cqmin ${st.color}${pulse ? "" : "CC"}` }}>
      {t.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.image} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ opacity: dim ? 0.25 : 0.8 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      )}
      {!t.image && <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${st.color}33, transparent 60%)` }} />}
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 45%, rgba(0,0,0,.85) 78%, rgba(0,0,0,.95) 100%)" }} />
      {/* status strip */}
      <div className="absolute inset-x-0 top-0" style={{ height: "2.4cqh", background: st.color, opacity: pulse ? 0.35 : 1 }} />

      <div className="absolute inset-x-0 top-0 flex items-start justify-between" style={{ padding: "4.5cqh 5cqw 0" }}>
        <span className="rounded font-bold uppercase text-white" style={{ fontSize: "7cqh", lineHeight: 1.1, background: "rgba(0,0,0,.55)", padding: "0.6cqh 2.2cqw" }}>{t.micLabel}</span>
        <span className="text-right font-medium text-white/70" style={{ fontSize: "4.6cqh", lineHeight: 1.15 }}>
          {t.receiverName ? <>{t.receiverName}<br />CH {t.channel}</> : "No receiver"}
        </span>
      </div>

      {(st.label || t.note || t.muted) && (
        <div className="absolute inset-x-0 flex flex-col items-center gap-[1cqh]" style={{ top: "26cqh" }}>
          {(st.label || (t.status === "critical" && t.note)) && (
            <span className="rounded font-extrabold tracking-wider text-white" style={{ fontSize: "6.5cqh", background: `${st.color}E6`, padding: "0.5cqh 3cqw" }}>{st.label || t.note?.toUpperCase()}</span>
          )}
          {t.muted && <span className="rounded font-bold text-white" style={{ fontSize: "5cqh", background: "#B91C1CE6", padding: "0.3cqh 2.5cqw" }}>MUTED</span>}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0" style={{ padding: "0 5cqw 4cqh" }}>
        <div className={clsx("truncate font-extrabold text-white", !t.person && "text-white/40")} style={{ fontSize: t.person ? (t.person.firstName.length > 8 ? "13cqh" : "16cqh") : "10cqh", lineHeight: 1.05, textShadow: "0 0.4cqh 1.6cqh rgba(0,0,0,.6)" }}>
          {t.person ? t.person.firstName : "Unassigned"}
        </div>
        <div className="truncate text-white/75" style={{ fontSize: "5cqh", lineHeight: 1.3, minHeight: "6.5cqh" }}>
          {t.person ? [t.person.name.split(/\s+/).slice(1).join(" "), t.person.position].filter(Boolean).join(" · ") : ""}
        </div>
        {/* meters */}
        <div className="mt-[2.5cqh] flex items-end gap-[3cqw]" style={{ opacity: t.battery || t.rf ? 1 : 0.35 }}>
          <Meter label={t.battery?.minutes != null ? runTime(t.battery.minutes) : t.battery?.percent != null ? `${t.battery.percent}%` : "BATT"}>
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} style={{ display: "block", flex: 1, height: "100%", borderRadius: "0.6cqh", background: bars != null && i <= bars ? (bars <= 1 ? "#EF4444" : bars <= 2 ? "#EAB308" : "#22C55E") : "rgba(255,255,255,.18)" }} />
            ))}
          </Meter>
          <Meter label={t.rf?.antennas ? t.rf.antennas.split("").map((a) => (/[AB R]/.test(a) && a !== "X" ? a : "–")).join(" ") : "RF"}>
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} style={{ display: "block", flex: 1, height: `${30 + i * 14}%`, alignSelf: "flex-end", borderRadius: "0.5cqh", background: i <= rfBars(t.rf?.dbm ?? null) ? "#38BDF8" : "rgba(255,255,255,.18)" }} />
            ))}
          </Meter>
          <Meter label="AUDIO">
            <span style={{ display: "block", flex: 1, height: "55%", alignSelf: "center", borderRadius: "0.6cqh", background: "rgba(255,255,255,.18)", position: "relative", overflow: "hidden" }}>
              <span style={{ position: "absolute", inset: 0, width: `${Math.min(100, ((t.audio ?? 0) / 50) * 100)}%`, background: (t.audio ?? 0) > 46 ? "#EF4444" : (t.audio ?? 0) > 38 ? "#EAB308" : "#22C55E", transition: "width .3s" }} />
            </span>
          </Meter>
        </div>
      </div>
    </div>
  );
}

function Meter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-end gap-[1cqw]" style={{ height: "6cqh" }}>{children}</div>
      <span className="mt-[0.6cqh] truncate font-semibold tabular-nums text-white/70" style={{ fontSize: "3.8cqh" }}>{label}</span>
    </div>
  );
}

/** All the tiles, filling the box they're in (no scrolling on a TV). */
export function MicGrid({ tiles, columns, now, width, height }: { tiles: BoardTile[]; columns: number; now: number; width: number; height: number }) {
  const cols = columns || bestColumns(tiles.length, width, height);
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  return (
    <div className="grid h-full w-full" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, gap: "max(6px, 0.8vmin)" }}>
      {tiles.map((t) => <MicTile key={t.channelId} t={t} now={now} />)}
    </div>
  );
}
