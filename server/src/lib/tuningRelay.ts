/**
 * Tuning keys pressed on an FOH companion, sent to Waves SuperRack by the main computer.
 *
 * MIDI goes out from the Cool Services window on the main computer (Web MIDI, the same way its own
 * Tuning bar does it), so the companion never sends MIDI and nothing changes on that computer. The
 * main window asks for presses with a long poll (/api/waves/next); a press is handed to exactly
 * one window, which sends it and reports back (/api/waves/result).
 */
import crypto from "node:crypto";
import { TUNING_EXTRAS, type CompanionTuning } from "../../../shared/types.js";
import { parseKey, tuningSongs } from "../../../shared/tuning.js";
import { boardPlan } from "./board.js";
import { logEvent, settings } from "./db.js";

export interface Press { id: string; slot: string; keyId: string; label: string; by: string }
type Result = { ok: boolean; snapshot?: number; error?: string };

const queue: Press[] = [];
const waiting: ((p: Press | null) => void)[] = [];
const pending = new Map<string, (r: Result) => void>();
let lastPoll = 0;
let last: CompanionTuning["last"] = null;

/** The Tuning row of the service the Mic board follows (open in Cool Services, or the next one). */
export async function companionTuning(): Promise<CompanionTuning | null> {
  const w = settings.get().waves;
  if (!w?.enabled) return null;
  const plan = await boardPlan().catch(() => null);
  const songs = plan ? tuningSongs(plan.items, w).sort((a, b) => a.sequence - b.sequence) : [];
  const snap = (id: string | undefined) => (id != null ? w.snapshots[id] ?? null : null);
  return {
    service: plan ? `${plan.serviceTypeName} · ${new Date(plan.sortDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}` : null,
    live: Boolean(w.output),
    buttons: [
      ...TUNING_EXTRAS.map((x) => ({ slot: x.id as string, kind: "extra" as const, label: x.short, key: null, title: x.label, n: null, snapshot: snap(x.id) })),
      ...songs.map((s, i) => {
        const k = parseKey(s.songKey);
        return { slot: s.id, kind: "song" as const, label: k?.label ?? (s.songKey || "—"), key: k?.id ?? null, title: s.title, n: i + 1, snapshot: snap(k?.id) };
      }),
    ],
    last,
  };
}

/** A press from a companion: hand it to the main window, wait for it to be sent. */
export async function relayPress(slot: string, by: string): Promise<Result> {
  const row = await companionTuning();
  if (!row) return { ok: false, error: "Waves SuperRack isn’t turned on in Cool Services on the main computer (Preferences → Audio)." };
  const b = row.buttons.find((x) => x.slot === slot);
  if (!b) return { ok: false, error: "That song isn’t in the service any more." };
  const keyId = b.kind === "extra" ? b.slot : b.key;
  if (!keyId) return { ok: false, error: `${b.title} has no key in Planning Center.` };
  if (Date.now() - lastPoll > 30_000) return { ok: false, error: "Open Cool Services on the main computer: it sends the keys to Waves." };
  const label = b.kind === "extra" ? b.title : `Song ${b.n} · ${b.label}`;
  const press: Press = { id: crypto.randomUUID(), slot, keyId, label, by };
  const result = new Promise<Result>((resolve) => {
    pending.set(press.id, resolve);
    setTimeout(() => { if (pending.delete(press.id)) resolve({ ok: false, error: "The main computer didn’t answer in time." }); }, 6000);
  });
  const w = waiting.shift();
  if (w) w(press); else queue.push(press);
  const r = await result;
  if (r.ok) { last = { slot, label, at: new Date().toISOString() }; logEvent(`waves: ${label} from ${by}`); }
  return r;
}

/** The main window: the next press to send (waits up to timeoutMs). */
export function nextPress(timeoutMs = 20_000): Promise<Press | null> {
  lastPoll = Date.now();
  const p = queue.shift();
  // A press that waited too long was already answered with an error: don't send it late.
  if (p) return Promise.resolve(pending.has(p.id) ? p : null);
  return new Promise((resolve) => {
    const fn = (x: Press | null) => { clearTimeout(t); resolve(x); };
    const t = setTimeout(() => { const i = waiting.indexOf(fn); if (i >= 0) waiting.splice(i, 1); lastPoll = Date.now(); resolve(null); }, timeoutMs);
    waiting.push(fn);
  });
}

/** A press handed to a window that had just gone away: give it to the next one. */
export function requeue(p: Press) {
  if (!pending.has(p.id)) return;
  const w = waiting.shift();
  if (w) w(p); else queue.unshift(p);
}

export function pressResult(id: string, r: Result) {
  const fn = pending.get(id);
  if (fn) { pending.delete(id); fn(r); }
}

/** A key pressed on the main computer's own Tuning bar (so the companion shows it too). */
export function notePressed(slot: string, label: string) { last = { slot, label, at: new Date().toISOString() }; }
