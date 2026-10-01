"use client";
/**
 * The clock output: full screen, nothing else. Used by the NDI sender and the second-display window
 * in the Mac app (from this Mac), and by TVs / iPads / stage displays at http://<this Mac>/clock.
 * ?ndi=1: the NDI sender (see-through when "Transparent background" is on); ?bg=transparent forces it.
 */
import { useEffect, useState } from "react";
import { ClockFace } from "@/components/clock/ClockFace";
import { useClockStream } from "@/components/clock/useClock";

export default function ClockOutputPage() {
  const { out, now, connected } = useClockStream("/api/clock-out", 20);
  const [q, setQ] = useState<{ ndi: boolean; clear: boolean }>({ ndi: false, clear: false });
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setQ({ ndi: p.get("ndi") === "1", clear: p.get("bg") === "transparent" });
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.cursor = "none";
  }, []);
  const transparent = q.clear || (q.ndi && Boolean(out?.transparent));
  const bg = transparent ? "transparent" : "#000";
  if (!out) return <div className="fixed inset-0" style={{ background: bg }} />;
  return (
    <div className="fixed inset-0" style={{ background: bg }}>
      <ClockFace state={out.state} now={now} showTimeOfDay={out.showTimeOfDay} transparent={transparent} title={out.title} infoHeading={out.infoHeading} />
      {!connected && !q.ndi && <div className="absolute left-3 top-3 rounded bg-red-600/80 px-2 py-0.5 text-xs text-white">Reconnecting…</div>}
    </div>
  );
}
