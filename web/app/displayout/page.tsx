"use client";
/**
 * The stage display output: full screen, nothing else. Opened by the second-display window in the
 * Mac app, and by TVs / stage screens at http://<this Mac>/display. Checks for changes every 2 s.
 */
import { useEffect, useState } from "react";
import type { DisplayState } from "@shared/board";
import { DisplayView } from "@/components/board/DisplayView";

export default function DisplayOutputPage() {
  const [s, setS] = useState<DisplayState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [lost, setLost] = useState(false);
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
    <div className="fixed inset-0 bg-black">
      <DisplayView s={s} now={now} />
      {lost && <div className="absolute bottom-3 left-3 rounded bg-red-600/80 px-2 py-0.5 text-xs text-white">Reconnecting…</div>}
    </div>
  );
}
