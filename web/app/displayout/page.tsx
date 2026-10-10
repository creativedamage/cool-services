"use client";
/**
 * The stage display output: full screen, nothing else. Opened by the second-display window in the
 * Mac app, and by TVs / stage screens at http://<this Mac>/display. Checks for changes every 2 s.
 * Press F to make it full screen (no address bar or tabs); F or Esc again to leave.
 */
import { useEffect, useState } from "react";
import type { DisplayState } from "@shared/board";
import { DisplayView } from "@/components/board/DisplayView";
import { useFullScreenKey } from "@/components/board/useFullScreen";

export default function DisplayOutputPage() {
  const [s, setS] = useState<DisplayState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [lost, setLost] = useState(false);
  const { full, toggle } = useFullScreenKey();
  // A hint for the first few seconds, until it's full screen.
  const [hint, setHint] = useState(true);
  useEffect(() => { const t = setTimeout(() => setHint(false), 6000); return () => clearTimeout(t); }, []);
  useEffect(() => {
    document.body.style.cursor = "none";
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/board-out/state", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        setS(await r.json());
        setLost(false);
      } catch { setLost(true); }
      if (!stop) setTimeout(tick, 2000);
    };
    void tick();
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => { stop = true; clearInterval(t); };
  }, []);
  if (!s) return <div className="fixed inset-0 bg-black" />;
  return (
    <div className="fixed inset-0 bg-black" onDoubleClick={toggle}>
      <DisplayView s={s} now={now} />
      {hint && !full && <div className="pointer-events-none absolute bottom-3 right-3 rounded bg-white/10 px-2.5 py-1 text-xs text-white/70">Press F for full screen</div>}
      {lost && <div className="absolute bottom-3 left-3 rounded bg-red-600/80 px-2 py-0.5 text-xs text-white">Reconnecting…</div>}
    </div>
  );
}
