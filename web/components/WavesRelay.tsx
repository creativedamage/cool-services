"use client";
/**
 * On the main computer: Tuning keys pressed on an FOH companion's Tuning strip arrive here and go to
 * Waves SuperRack over MIDI from this Mac, exactly like pressing them on the Tuning bar. Each press is
 * handed to one window only (the server keeps the queue), so two open windows never send it twice.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { Api } from "@/lib/api";
import { sendKey } from "@/lib/waves";

const SKIP = /^\/(companion|kiosk|displayout|clockout|team|start|setup-mode)(\/|$)/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function WavesRelay() {
  useEffect(() => {
    if (SKIP.test(location.pathname)) return;
    let stop = false;
    void (async () => {
      let wait = 0;
      while (!stop) {
        try {
          const r = await fetch("/api/waves/next", { credentials: "include", cache: "no-store" });
          if (!r.ok) { await sleep(r.status === 401 ? 30_000 : 5000); continue; }
          const { press } = (await r.json()) as { press: { id: string; keyId: string; label: string; by: string } | null };
          wait = 0;
          if (!press || stop) continue;
          let result: { ok: boolean; snapshot?: number; error?: string };
          try {
            const s = await Api.settings();
            const snapshot = await sendKey(s.waves, press.keyId);
            result = { ok: true, snapshot };
            toast.success(`Waves: ${press.label}`, { description: `From ${press.by} · SuperRack snapshot ${snapshot}` });
          } catch (e) {
            result = { ok: false, error: (e as Error).message };
            toast.error(`Couldn’t send ${press.label} to Waves`, { description: `${press.by}: ${(e as Error).message}` });
          }
          await fetch("/api/waves/result", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: press.id, ...result }) }).catch(() => undefined);
        } catch {
          wait = Math.min(30_000, (wait || 1000) * 2);
          await sleep(wait);
        }
      }
    })();
    return () => { stop = true; };
  }, []);
  return null;
}
