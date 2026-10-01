"use client";
/**
 * The clock as it appears on outputs (network, NDI, second display) and in previews, laid out like
 * a broadcast production clock:
 *
 *   ┌──────────────── MASTER TIME ────────────────┐
 *   │  01:30 (second timer)  │  INFORMATION        │
 *   │                        │  ALPHA (Session 1)  │
 *   ├─────────────────────────────────────────────┤
 *   │                 24:50  (main timer)          │
 *   └─────────────────────────────────────────────┘
 *
 * Sized by its container (container query units), so the same face works full screen and small.
 */
import { DEFAULT_LABEL, DEFAULT_TIMER_COLOR, readClock, timeOfDay, type ClockState, type ClockTone } from "@shared/clock";

const FONT = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, system-ui, sans-serif";
const BOX = "#1C1C1E";
const EDGE = "rgba(255,255,255,.28)";

/** Production clocks show two-digit minutes: 01:30, 24:50, +00:12. */
const two = (t: string) => t.replace(/^(\+?)(\d):(\d\d)$/, (_m, sign: string, m: string, sec: string) => `${sign}0${m}:${sec}`);

function toneColor(tone: ClockTone, base: string) {
  return tone === "warn" ? "#FFC21A" : tone === "danger" || tone === "over" ? "#FF1F1F" : tone === "idle" ? "#6B7280" : base;
}

export function ClockFace({ state, now, showTimeOfDay = true, transparent = false, title = "MASTER TIME", infoHeading = "INFORMATION", className }: {
  state: ClockState; now: number; showTimeOfDay?: boolean; transparent?: boolean; title?: string; infoHeading?: string; className?: string;
}) {
  const raw = readClock(state.main, now, state.warnSec, state.dangerSec);
  const main = { ...raw, text: two(raw.text) };
  const base = state.timerColor || DEFAULT_TIMER_COLOR;
  // Near the end the main timer pulses (the colour change alone can be missed from a stage).
  const pulse = (main.tone === "over" || (main.tone === "danger" && base.toUpperCase() === DEFAULT_TIMER_COLOR)) && Math.floor(now / 500) % 2 === 0;

  // Left box: the second timer, or the time of day.
  const secWaiting = Boolean(state.secondary?.startWhenMainEnds && !state.secondary.running);
  const sec = state.secondary ? readClock(state.secondary, now) : null;
  const aux = state.secondary
    ? {
        // Its own label only when one was given ("Over"), not the mode's default.
        label: state.secondary.idle ? "" : state.secondary.label === DEFAULT_LABEL[state.secondary.mode] ? "" : state.secondary.label,
        text: secWaiting ? "00:00" : two(sec!.text), color: secWaiting ? "#6B7280" : sec!.tone === "over" ? "#FF1F1F" : "#FFFFFF" }
    : showTimeOfDay ? { label: "", text: timeOfDay(now), color: "#FFFFFF" } : null;

  // Right box: Information.
  const infoTitle = state.info?.title || state.main.idle || state.main.label;
  const infoSub = state.info?.subtitle || (state.presetName && state.presetName !== infoTitle ? state.presetName : "");
  const showInfo = !state.info?.hidden;

  const box: React.CSSProperties = {
    background: transparent ? "rgba(20,20,22,.88)" : BOX, border: `0.22cqh solid ${EDGE}`, borderRadius: "0.9cqh",
  };
  const msg = state.message;
  const pos = state.messagePosition ?? "bottom";

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", containerType: "size", background: transparent ? "transparent" : "#000", fontFamily: FONT, color: "#fff" }}>
      <div style={{ position: "absolute", inset: "2.4cqh 1.6cqw", display: "flex", flexDirection: "column", gap: "1.6cqh" }}>
        {title && (
          <div style={{ ...box, height: "9.5cqh", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: "6.6cqh", fontWeight: 600, letterSpacing: "0.02em", color: "#C9CACC", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
          </div>
        )}

        {(aux || showInfo) && (
          <div style={{ display: "flex", gap: "1.2cqw", height: "25cqh", flexShrink: 0 }}>
            {aux && (
              <div style={{ ...box, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 0 }}>
                {aux.label && <span style={{ fontSize: "3.6cqh", color: "#C9CACC", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "-0.5cqh" }}>{aux.label}</span>}
                <span style={{ fontSize: aux.text.length > 8 ? "11cqh" : "15cqh", lineHeight: 1, color: aux.color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{aux.text}</span>
              </div>
            )}
            {showInfo && (
              <div style={{ ...box, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", minWidth: 0, padding: "0 1cqw" }}>
                <span style={{ fontSize: "4.4cqh", color: "#E5E5E7", lineHeight: 1.1 }}>{infoHeading}</span>
                <span style={{ fontSize: infoTitle.length > 16 ? "6cqh" : "8.2cqh", fontWeight: 700, color: "#FFE81A", lineHeight: 1.05, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: "uppercase" }}>{infoTitle}</span>
                {infoSub && <span style={{ fontSize: "4.8cqh", color: "#E9762B", lineHeight: 1.15, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>({infoSub})</span>}
              </div>
            )}
          </div>
        )}

        <div style={{ ...box, flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 0 }}>
          {!state.blank && (
            <span style={{
              fontSize: main.text.length > 8 ? "24cqh" : main.text.length > 5 ? "30cqh" : "38cqh", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.01em",
              color: toneColor(main.tone, base), opacity: pulse ? 0.45 : 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", transition: "color .3s",
            }}>
              {main.text}
            </span>
          )}
          {msg && (
            <div style={pos === "full"
              ? { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: transparent ? "rgba(0,0,0,.9)" : "#000", padding: "0 3cqw" }
              : { position: "absolute", left: "2cqw", right: "2cqw", [pos === "top" ? "top" : "bottom"]: "2cqh", display: "flex", justifyContent: "center" }}>
              <span style={{
                background: "#000", color: "#fff", border: `0.3cqh solid ${EDGE}`, borderRadius: "0.8cqh", padding: "0.8cqh 2cqw",
                fontSize: pos === "full" ? (msg.length > 30 ? "9cqh" : "13cqh") : "6.4cqh", fontWeight: 700, textAlign: "center", lineHeight: 1.1,
                textTransform: "uppercase", textDecoration: "underline", textUnderlineOffset: "0.15em", textDecorationThickness: "0.06em",
              }}>{msg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
