/**
 * Tuning: song keys and Waves SuperRack snapshot numbers. Shared by the UI (Tuning bar, dashboard)
 * and the server (the FOH companion's Tuning strip).
 */
import { KEY_ROOTS, TUNING_EXTRAS, type KeyRoot, type WavesSettings } from "./types.js";

/** Spellings that aren't in the list are the same pitch as one that is. */
const SAME_AS: Record<string, KeyRoot> = { "C#": "Db", "D#": "Eb", "G#": "Ab", "A#": "Bb", "E#": "F", "B#": "C", Cb: "B", Fb: "E" };

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Songs for the Tuning bar, in service order, without the ones listed to leave out (e.g. Vocal Warm Ups). */
export function tuningSongs<T extends { kind: string; title: string }>(items: T[], w: WavesSettings | undefined): T[] {
  const hide = new Set((w?.hideFromTuning ?? ["Vocal Warm Ups"]).map(norm));
  return items.filter((i) => i.kind === "song" && !hide.has(norm(i.title)));
}

/** A name for a snapshot slot: "C", "Chromatic Tune"… */
export const slotLabel = (id: string) => TUNING_EXTRAS.find((x) => x.id === id)?.label ?? id;

/**
 * "A", "Db", "C#", "F#m", "Bb (capo 1)" → { root, id }. F# and Gb have their own snapshots; C#, D#, G#
 * and A# use their flats (C# → Db); a minor key uses its letter's snapshot (F#m → F#). The label
 * stays as written in Planning Center.
 */
export function parseKey(raw: string | null | undefined): { root: KeyRoot; minor: boolean; id: string; label: string } | null {
  if (!raw) return null;
  const m = raw.trim().replace(/♯/g, "#").replace(/♭/g, "b").match(/^([A-Ga-g])([#b]?)\s*(maj(or)?|min(or)?|m(?!aj))?/);
  if (!m) return null;
  const name = m[1].toUpperCase() + m[2];
  const root = (KEY_ROOTS as readonly string[]).includes(name) ? (name as KeyRoot) : SAME_AS[name];
  if (!root) return null;
  const minor = Boolean(m[3] && /^m(in|$)/i.test(m[3]) && !/^maj/i.test(m[3]));
  // Shown as written in Planning Center (e.g. "F#m").
  const label = `${m[1].toUpperCase()}${m[2]}${minor ? "m" : ""}`;
  return { root, minor, id: root, label };
}

/** The Bank LSB and Program Change that recall a snapshot number. */
export function snapshotMidi(n: number, numbering: WavesSettings["numbering"] = "externalId"): { bank: number; program: number } {
  return numbering === "program"
    ? { bank: Math.floor((n - 1) / 128), program: (n - 1) % 128 }
    : { bank: Math.floor(n / 125), program: n % 125 };
}
