"use client";
/**
 * The FOH companion's mic strip (its own small window along the bottom of the screen, always on top),
 * with the Tuning strip above it. The page is see-through around the tiles. A page request hides it
 * and takes over the screen; once it's answered the strip comes back.
 */
import { Hand, MonitorUp, Settings, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { CompanionState, DisplayInfo } from "@shared/types";
import { TUNING_STRIP_H, TuningStrip } from "@/components/board/TuningStrip";
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
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  useEffect(() => {
    const load = () => void Api.companionStrip().then((r) => setDisplays(r.displays)).catch(() => undefined);
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  // Move the strip to the next display (the window follows).
  const nextDisplay = () => {
    if (!st || displays.length < 2) return;
    const cur = displays.findIndex((d) => d.id === st.strip.displayId);
    const at = cur >= 0 ? cur : displays.findIndex((d) => d.primary);
    const d = displays[(at + 1) % displays.length];
    void Api.saveCompanionStrip({ displayId: d.id, displayLabel: d.label });
  };
  const showTuning = st?.strip.tuning !== false;
  const tuneH = TUNING_STRIP_H[st?.strip.size ?? "m"];
  const open = () => void Api.companionWindow("full");
  const held = st?.requests.filter((r) => r.state === "waiting" && r.heldAt).length ?? 0;

  return (
    <main className="group relative h-screen w-screen overflow-hidden p-[4px]" style={{ background: "transparent" }}>
      <style>{"html,body{background:transparent!important}"}</style>
      <div className="flex h-full w-full flex-col gap-[4px]">
        {st && showTuning && (
          <div className="shrink-0" style={{ height: tuneH - 4 }}>
            <TuningStrip tuning={st.tuning} connected={st.connected} onPress={(slot) => Api.companionTuning(slot)} />
          </div>
        )}
        <div className="min-h-0 flex-1">
          {st && st.mics.length > 0 ? (
            <MicStripRow tiles={st.mics} now={now} history={history} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl bg-[#222] text-sm text-[#8A8A8A]">
              {st ? (st.connected ? "No mics on the main computer’s mic board yet" : "Connecting to the main computer…") : ""}
            </div>
          )}
        </div>
      </div>

      {/* what needs attention, and the way back to the full companion window */}
      <div className="absolute right-2 flex items-center gap-1.5" style={{ top: showTuning ? tuneH + 4 : 8 }}>
        {st && !st.connected && (
          <button onClick={open} className="flex items-center gap-1 rounded-full bg-rose-700/90 px-2.5 py-1 text-xs font-medium text-white shadow-lg"><WifiOff size={12} /> {st.error ?? "Can’t reach the main computer"}</button>
        )}
        {held > 0 && (
          <button onClick={open} className="flex items-center gap-1 rounded-full bg-amber-500/95 px-2.5 py-1 text-xs font-semibold text-black shadow-lg"><Hand size={12} /> {held} page{held > 1 ? "s" : ""} on hold</button>
        )}
        {displays.length > 1 && (
          <button onClick={nextDisplay} title="Move the strip to the next display"
            className="grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white/80 opacity-0 shadow-lg transition group-hover:opacity-100"><MonitorUp size={13} /></button>
        )}
        <button onClick={open} title="Open the FOH companion (settings, held pages)"
          className="grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white/80 opacity-0 shadow-lg transition group-hover:opacity-100"><Settings size={13} /></button>
      </div>
    </main>
  );
}
