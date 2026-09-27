"use client";
/**
 * Waves SuperRack over MIDI (Web MIDI, from this Mac).
 *
 * SuperRack recalls snapshot N when it receives Bank LSB (CC 32) = floor((N-1)/128) and then
 * Program Change (N-1) % 128 on its MIDI input. Each song key is mapped to a snapshot in Settings,
 * so pressing a key recalls the snapshot that has your tuning set up for it.
 *
 * SuperRack side: add the MIDI Controller module (Controllers section), tick this MIDI input in its
 * settings, and give each snapshot an External ID. SuperRack recalls by External ID, not by where
 * a snapshot sits in the list: "snapshot N" here means External ID Bank floor((N-1)/128),
 * PC (N-1) % 128 — i.e. snapshot 1 = Bank 0 / PC 0.
 *
 * SuperRack on this Mac: turn on the IAC Driver (Audio MIDI Setup) and pick it in both apps.
 * SuperRack on another computer: use a Network MIDI session (Audio MIDI Setup → Network).
 */
import { useEffect, useState } from "react";
import { KEY_ROOTS, type KeyRoot, type WavesSettings } from "@shared/types";

/** Spellings that aren't in the list are the same pitch as one that is. */
const SAME_AS: Record<string, KeyRoot> = { "E#": "F", "B#": "C", Cb: "B", Fb: "E" };

/**
 * "A", "Db", "C#", "F#m", "Bb (capo 1)" → { root, id }. Sharps and flats each have their own snapshot
 * (C# and Db are matched separately); a minor key uses its letter's snapshot (F#m → F#).
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
export async function sendKey(w: WavesSettings, keyId: string): Promise<number> {
  if (!w.enabled) throw new WavesError("Turn on Waves SuperRack in Settings first.");
  const snap = w.snapshots[keyId];
  if (!snap) throw new WavesError(`No Waves snapshot is matched to ${keyId} in Settings.`);
  if (!w.output) throw new WavesError("Choose the MIDI output for SuperRack in Settings.");
  const a = await midiAccess();
  const out = [...a.outputs.values()].find((o) => o.name === w.output);
  if (!out) throw new WavesError(`“${w.output}” isn’t connected. Check Audio MIDI Setup, or choose another output in Settings.`);
  const ch = Math.min(15, Math.max(0, w.channel - 1));
  const n = snap - 1;
  out.send([0xb0 | ch, 32, Math.floor(n / 128)]); // Bank LSB
  out.send([0xc0 | ch, n % 128]); // Program Change
  return snap;
}
