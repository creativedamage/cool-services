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
import type { WavesSettings } from "@shared/types";
import { slotLabel, snapshotMidi } from "@shared/tuning";

// Keys, songs and snapshot numbers live in shared/tuning.ts (the server uses them for the FOH
// companion's Tuning strip).
export { parseKey, slotLabel, snapshotMidi, tuningSongs } from "@shared/tuning";

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
  if (!w.enabled) throw new WavesError("Turn on Waves SuperRack in Preferences → Audio first.");
  const snap = w.snapshots[keyId];
  if (snap == null) throw new WavesError(`No Waves snapshot is set for ${slotLabel(keyId)} in Preferences → Audio.`);
  if (!w.output) throw new WavesError("Choose the MIDI output for SuperRack in Preferences → Audio.");
  const a = await midiAccess();
  const out = [...a.outputs.values()].find((o) => o.name === w.output);
  if (!out) throw new WavesError(`“${w.output}” isn’t connected. Check Audio MIDI Setup, or choose another output in Preferences → Audio.`);
  const ch = Math.min(15, Math.max(0, w.channel - 1));
  const { bank, program } = snapshotMidi(snap, w.numbering);
  out.send([0xb0 | ch, 32, bank]); // Bank LSB
  out.send([0xc0 | ch, program]); // Program Change
  return snap;
}
