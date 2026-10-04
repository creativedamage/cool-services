"use client";
/**
 * The FOH companion's Tuning strip: the main computer's Tuning row (Chromatic Tune, Tuning Off, each
 * song's key in service order), right above the mic strip. Pressing one asks the main computer to
 * send it to Waves SuperRack; this computer never sends MIDI.
 */
import clsx from "clsx";
import { AudioLines, Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { CompanionTuning } from "@shared/types";

export const TUNING_STRIP_H = { s: 62, m: 74, l: 88 } as const;

export function TuningStrip({ tuning, connected, onPress }: {
  tuning: CompanionTuning | null; connected: boolean;
  onPress: (slot: string) => Promise<{ ok: boolean; snapshot?: number; error?: string }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ slot: string; ok: boolean; text: string } | null>(null);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), flash.ok ? 1800 : 4500); return () => clearTimeout(t); }, [flash]);

  const press = async (slot: string, label: string) => {
    if (busy) return;
    setBusy(slot);
    try {
      const r = await onPress(slot);
      setFlash(r.ok ? { slot, ok: true, text: `${label} · snapshot ${r.snapshot}` } : { slot, ok: false, text: r.error ?? "Didn’t send" });
    } catch (e) { setFlash({ slot, ok: false, text: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const shell = "flex h-full w-full items-stretch gap-[5px] rounded-xl bg-[#161616]/95 p-[5px] [container-type:size]";
  if (!tuning) {
    return (
      <div className={clsx(shell, "items-center justify-center text-sm text-[#8A8A8A]")}>
        <AudioLines size={15} className="mr-2" /> {connected ? "Tuning: turn on Waves SuperRack on the main computer (Preferences → Audio)" : "Tuning: connecting to the main computer…"}
      </div>
    );
  }
  const last = flash?.ok ? flash.slot : tuning.last?.slot ?? null;
  return (
    <div className={shell} style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif" }}>
      <div className="flex w-[92px] shrink-0 flex-col justify-center px-1.5 leading-tight">
        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#A78BFA]"><AudioLines size={12} /> Tuning</span>
        <span className="line-clamp-2 text-[10px] text-[#8A8A8A]">{tuning.live ? tuning.service ?? "No service" : "Waves has no MIDI output on the main computer"}</span>
      </div>
      <div className="flex min-w-0 flex-1 gap-[5px] overflow-x-auto [scrollbar-width:none]">
        {tuning.buttons.map((b) => {
          const on = last === b.slot;
          const extra = b.kind === "extra";
          const label = extra ? b.title : `Song ${b.n} · ${b.label}`;
          return (
            <button key={b.slot} disabled={!tuning.live || busy !== null} onClick={() => void press(b.slot, label)}
              title={b.snapshot != null ? `${b.title} · SuperRack snapshot ${b.snapshot}` : extra ? `Set a snapshot for ${b.title} on the main computer` : b.key ? `No snapshot set for ${b.key} on the main computer` : "No key in Planning Center"}
              className={clsx("relative flex shrink-0 flex-col items-center justify-center rounded-lg border px-2 text-center transition active:scale-[0.97] disabled:cursor-default",
                extra ? "w-[96px]" : "min-w-[112px] max-w-[190px] flex-1",
                on ? "border-[#4CAF50] bg-[#4CAF50]/20" : "border-[#333] bg-[#222] hover:border-[#A78BFA]/70",
                b.snapshot == null && "opacity-55")}>
              {on && <Check size={12} className="absolute right-1.5 top-1.5 text-[#6BD46F]" />}
              {busy === b.slot && <Loader2 size={12} className="absolute left-1.5 top-1.5 animate-spin text-white/70" />}
              {extra ? (
                <span className={clsx("font-semibold", b.slot === "OFF" ? "text-[#D0D0D0]" : "text-[#A78BFA]")} style={{ fontSize: "min(32cqh, 15px)" }}>{b.label}</span>
              ) : (<>
                <span className="font-mono font-semibold leading-none text-[#A78BFA]" style={{ fontSize: "min(46cqh, 30px)" }}>{b.label}</span>
                <span className="mt-0.5 w-full truncate text-[#B8B8B8]" style={{ fontSize: "min(17cqh, 11px)" }}><b className="text-[#8A8A8A]">{b.n}</b> {b.title}</span>
              </>)}
            </button>
          );
        })}
        {tuning.buttons.length <= 2 && <div className="flex items-center px-3 text-xs text-[#8A8A8A]">No songs in this service yet</div>}
      </div>
      {flash && (
        <div className={clsx("flex max-w-[260px] shrink-0 items-center rounded-lg px-3 text-xs font-medium", flash.ok ? "bg-[#4CAF50]/20 text-[#8BE08E]" : "bg-rose-700/80 text-white")}>
          {flash.ok ? `Sent: ${flash.text}` : flash.text}
        </div>
      )}
    </div>
  );
}
