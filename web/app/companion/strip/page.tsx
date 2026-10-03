"use client";
/**
 * The FOH companion's mic strip (its own small window along the bottom of the screen, always on top).
 * The page is see-through around the tiles. A page request hides it and takes over the screen; once
 * it's answered the strip comes back.
 */
import { Hand, Settings, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { CompanionState } from "@shared/types";
import { Api } from "@/lib/api";
import { MicStripRow } from "@/components/board/MicStrip";
import { useTileHistory } from "@/components/board/DisplayView";

export default function MicStripPage() {
  const [st, setSt] = useState<CompanionState | null>(null);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let stop = false;
    const poll = async () => { try { const s = await Api.companionState(); if (!stop) { setSt(s); setTick((n) => n + 1); } } catch { /* keep the last */ } };
    void poll();
    const a = setInterval(poll, 1000);
    const b = setInterval(() => setNow(Date.now()), 350);
    return () => { stop = true; clearInterval(a); clearInterval(b); };
  }, []);
  const history = useTileHistory(st?.mics ?? [], String(tick));
  const open = () => void Api.companionWindow("full");
  const held = st?.requests.filter((r) => r.state === "waiting" && r.heldAt).length ?? 0;

  return (
    <main className="group relative h-screen w-screen overflow-hidden p-[4px]" style={{ background: "transparent" }}>
      <style>{"html,body{background:transparent!important}"}</style>
      {st && st.mics.length > 0 ? (
        <MicStripRow tiles={st.mics} now={now} history={history} />
      ) : (
        <div className="flex h-full items-center justify-center rounded-xl bg-[#222] text-sm text-[#8A8A8A]">
          {st ? (st.connected ? "No mics on the main computer’s mic board yet" : "Connecting to the main computer…") : ""}
        </div>
      )}

      {/* what needs attention, and the way back to the full companion window */}
      <div className="absolute right-2 top-2 flex items-center gap-1.5">
        {st && !st.connected && (
          <button onClick={open} className="flex items-center gap-1 rounded-full bg-rose-700/90 px-2.5 py-1 text-xs font-medium text-white shadow-lg"><WifiOff size={12} /> {st.error ?? "Can’t reach the main computer"}</button>
        )}
        {held > 0 && (
          <button onClick={open} className="flex items-center gap-1 rounded-full bg-amber-500/95 px-2.5 py-1 text-xs font-semibold text-black shadow-lg"><Hand size={12} /> {held} page{held > 1 ? "s" : ""} on hold</button>
        )}
        <button onClick={open} title="Open the FOH companion (settings, held pages)"
          className="grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white/80 opacity-0 shadow-lg transition group-hover:opacity-100"><Settings size={13} /></button>
      </div>
    </main>
  );
}
