"use client";
/**
 * Tuning: every song's key, big, left to right in service order. With Waves SuperRack set up in
 * Settings, pressing a key recalls the snapshot for that key over MIDI.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AudioLines, Check, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { PlanDetail } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { parseKey, sendKey } from "@/lib/waves";

export function SongKeys({ plan }: { plan: PlanDetail }) {
  const settings = useQuery({ queryKey: qk.settings, queryFn: Api.settings, staleTime: 30_000 });
  const waves = settings.data?.waves;
  const live = Boolean(waves?.enabled && waves.output);
  const songs = plan.items.filter((i) => i.kind === "song").sort((a, b) => a.sequence - b.sequence);
  const [sent, setSent] = useState<string | null>(null); // item id last sent to Waves
  const [busy, setBusy] = useState<string | null>(null);
  if (!songs.length) return null;

  async function press(itemId: string, keyId: string | undefined, label: string) {
    if (!waves?.enabled) return;
    if (!keyId) return toast.error("This song has no key in Planning Center");
    setBusy(itemId);
    try {
      const snap = await sendKey(waves, keyId);
      setSent(itemId);
      toast.success(`Waves: ${label}`, { description: `Recalled SuperRack snapshot ${snap}` });
    } catch (e) {
      toast.error("Couldn’t send to Waves", { description: (e as Error).message });
    } finally { setBusy(null); }
  }

  return (
    <section className="border-b border-line px-6 py-4">
      <div className="mb-2.5 flex items-center gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><AudioLines size={15} className="text-violet" /> Tuning</h2>
        <span className={clsx("text-[11px]", live ? "text-ok" : "text-ink-faint")}>
          {live ? `Press a key to recall it in Waves SuperRack · ${waves!.output}` : "Song keys in service order"}
        </span>
        {!waves?.enabled && (
          <Link href="/settings#waves" className="btn-ghost ml-auto py-1 text-[11px]"><Settings2 size={12} /> Connect Waves</Link>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {songs.map((s, i) => {
          const k = parseKey(s.songKey);
          const snap = k && waves?.snapshots[k.id];
          const Tag = waves?.enabled ? "button" : "div";
          return (
            <Tag key={s.id} onClick={waves?.enabled ? () => press(s.id, k?.id, `Song ${i + 1} · ${k?.label ?? "?"}`) : undefined}
              title={waves?.enabled ? (k ? (snap ? `Recall SuperRack snapshot ${snap}` : `No Waves snapshot matched to ${k.root}`) : "No key in Planning Center") : s.title}
              className={clsx("relative flex w-[132px] shrink-0 flex-col items-center rounded-xl border px-3 pb-2.5 pt-2 text-center transition",
                sent === s.id ? "border-ok/60 bg-ok-soft" : "border-line bg-raised",
                waves?.enabled && "hover:border-violet/60 active:scale-[0.97]")}>
              {sent === s.id && <Check size={13} className="absolute right-2 top-2 text-ok" />}
              <span className={clsx("font-mono text-[34px] font-semibold leading-tight", k ? "text-violet" : "text-ink-faint")}>
                {busy === s.id ? "…" : k?.label ?? (s.songKey || "—")}
              </span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Song {i + 1}</span>
              <span className="line-clamp-2 w-full break-words text-xs leading-snug text-ink-soft">{s.title}</span>
            </Tag>
          );
        })}
      </div>
    </section>
  );
}
