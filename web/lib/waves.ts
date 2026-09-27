"use client";
/**
 * Waves SuperRack over MIDI (Web MIDI, from this Mac).
 *
 * SuperRack recalls a snapshot by its External ID when it receives Bank LSB (CC 32) and then a
 * Program Change. SuperRack's External IDs run 125 to a bank (1,000 over 8 banks): ID 139 is
 * Bank 1 / Program 14. (Confirmed on a real SuperRack; Waves' own help page says 128 a bank.) Each song key is mapped to a snapshot in Settings,
 * so pressing a key recalls the snapshot that has your tuning set up for it.
 *
 * SuperRack side: add the MIDI Controller module (Controllers section), tick this MIDI input in its
 * settings, and give each snapshot an External ID. SuperRack recalls by External ID, not by where
 * a snapshot sits in the list. "program" numbering (1 = Bank 0 / PC 0, 128 a bank) is there for other
 * setups.
 *
 * SuperRack on this Mac: turn on the IAC Driver (Audio MIDI Setup) and pick it in both apps.
 * SuperRack on another computer: use a Network MIDI session (Audio MIDI Setup → Network).
 */
import { useEffect, useState } from "react";
import { KEY_ROOTS, TUNING_EXTRAS, type KeyRoot, type WavesSettings } from "@shared/types";

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

let access: Promise<MIDIAccess> | null = null;
export function midiAccess(): Promise<MIDIAccess> {
  if (typeof navigator === "undefined" || !("requestMIDIAccess" in navigator)) return Promise.reject(new Error("MIDI isn’t available here."));
  access ??= navigator.requestMIDIAccess({ sysex: false }).catch((e) => { access = null; throw e; });
  return access;
}

/** MIDI outputs on this Mac, kept up to date as devices come and go. */
export function useMidiOutputs(enabled = true) {
  const [outputs, setOutputs] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let a: MIDIAccess | null = null;
    const refresh = () => a && setOutputs([...a.outputs.values()].map((o) => o.name ?? "MIDI output").filter(Boolean));
    midiAccess().then((x) => { a = x; refresh(); x.addEventListener("statechange", refresh); })
      .catch((e) => setError((e as Error).message || "MIDI access was refused."));
    return () => a?.removeEventListener("statechange", refresh);
  }, [enabled]);
  return { outputs, error };
}

export class WavesError extends Error {}

/** Recall the SuperRack snapshot mapped to this key. Returns the snapshot number sent. */
/** The Bank LSB and Program Change that recall a snapshot number. */
export function snapshotMidi(n: number, numbering: WavesSettings["numbering"] = "externalId"): { bank: number; program: number } {
  return numbering === "program"
    ? { bank: Math.floor((n - 1) / 128), program: (n - 1) % 128 }
    : { bank: Math.floor(n / 125), program: n % 125 };
}

export async function sendKey(w: WavesSettings, keyId: string): Promise<number> {
  if (!w.enabled) throw new WavesError("Turn on Waves SuperRack in Settings first.");
  const snap = w.snapshots[keyId];
  if (snap == null) throw new WavesError(`No Waves snapshot is set for ${slotLabel(keyId)} in Settings.`);
  if (!w.output) throw new WavesError("Choose the MIDI output for SuperRack in Settings.");
  const a = await midiAccess();
  const out = [...a.outputs.values()].find((o) => o.name === w.output);
  if (!out) throw new WavesError(`“${w.output}” isn’t connected. Check Audio MIDI Setup, or choose another output in Settings.`);
  const ch = Math.min(15, Math.max(0, w.channel - 1));
  const { bank, program } = snapshotMidi(snap, w.numbering);
  out.send([0xb0 | ch, 32, bank]); // Bank LSB
  out.send([0xc0 | ch, program]); // Program Change
  return snap;
}
