/**
 * Allen & Heath dLive and Avantis: channel names over "MIDI over TCP/IP".
 *
 *  - dLive MixRack: TCP 51325 · dLive Surface: TCP 51328 · Avantis: TCP 51325 (unencrypted ports).
 *  - Messages are SysEx with the A&H header F0 00 00 1A 50 10 01 00, then 0N (MIDI channel − 1,
 *    the console's base channel set in Utility → Control → MIDI), a command and the channel:
 *      set name  0N 03 CH <ASCII> F7        get name  0N 01 CH F7  →  reply 0N 02 CH <ASCII> F7
 *    Inputs 1–128 (dLive) / 1–64 (Avantis) are CH 00–7F on the base channel.
 *  - Names show 8 characters on the strips, so they're cut to 8 and kept to plain ASCII.
 *
 * Only names are written; nothing else on the console is touched.
 */
import net from "node:net";

export type ConsoleModel = "dlive" | "avantis";
export interface ConsoleConfig {
  enabled: boolean;
  model: ConsoleModel;
  host: string;
  port: number;
  /** The console's MIDI base channel, 1–16 (dLive default 1, Avantis default 12). */
  midiChannel: number;
}
export interface NameWrite { input: number; name: string }

const HEADER = [0xf0, 0x00, 0x00, 0x1a, 0x50, 0x10, 0x01, 0x00];
export const MAX_INPUTS: Record<ConsoleModel, number> = { dlive: 128, avantis: 64 };
export const NAME_LEN = 8;

/** Plain ASCII (accents dropped), at most 8 characters. */
export function consoleName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, NAME_LEN).trim();
}

export function setNameMsg(midiChannel: number, input: number, name: string): Buffer {
  const n = (midiChannel - 1) & 0x0f;
  return Buffer.from([...HEADER, n, 0x03, (input - 1) & 0x7f, ...Buffer.from(consoleName(name), "ascii"), 0xf7]);
}
export function getNameMsg(midiChannel: number, input: number): Buffer {
  return Buffer.from([...HEADER, (midiChannel - 1) & 0x0f, 0x01, (input - 1) & 0x7f, 0xf7]);
}

function connect(cfg: ConsoleConfig, timeoutMs = 3000): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: cfg.host, port: cfg.port });
    const t = setTimeout(() => { sock.destroy(); reject(new Error(`No answer from ${cfg.host}:${cfg.port}. Check the IP address, and that the console is on this network.`)); }, timeoutMs);
    sock.once("connect", () => { clearTimeout(t); resolve(sock); });
    sock.once("error", (e) => { clearTimeout(t); reject(new Error(`Can’t connect to ${cfg.host}:${cfg.port} (${(e as NodeJS.ErrnoException).code ?? e.message}).`)); });
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Write channel names. Sent one by one with a short gap so the console keeps up. */
export async function writeNames(cfg: ConsoleConfig, writes: NameWrite[]): Promise<{ sent: number }> {
  const max = MAX_INPUTS[cfg.model];
  const bad = writes.find((w) => w.input < 1 || w.input > max);
  if (bad) throw new Error(`Input ${bad.input} doesn’t exist on ${cfg.model === "dlive" ? "dLive" : "Avantis"} (1–${max}).`);
  const sock = await connect(cfg);
  try {
    for (const w of writes) {
      await new Promise<void>((res, rej) => sock.write(setNameMsg(cfg.midiChannel, w.input, w.name), (e) => (e ? rej(e) : res())));
      await wait(15);
    }
    await wait(100);
  } finally {
    sock.end();
  }
  return { sent: writes.length };
}

/** Read one input's name (used by "Test connection"). */
export async function readName(cfg: ConsoleConfig, input: number): Promise<string | null> {
  const sock = await connect(cfg);
  try {
    return await new Promise<string | null>((resolve) => {
      let buf = Buffer.alloc(0);
      const done = (v: string | null) => { clearTimeout(t); sock.removeAllListeners("data"); resolve(v); };
      const t = setTimeout(() => done(null), 1500);
      sock.on("data", (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        // Find a "name reply" SysEx for this input: header, 0N, 02, CH, name…, F7
        for (let i = 0; i + HEADER.length + 3 < buf.length; i++) {
          if (HEADER.every((b, j) => buf[i + j] === b) && buf[i + HEADER.length + 1] === 0x02 && buf[i + HEADER.length + 2] === ((input - 1) & 0x7f)) {
            const end = buf.indexOf(0xf7, i + HEADER.length + 3);
            if (end > 0) return done(buf.subarray(i + HEADER.length + 3, end).toString("ascii"));
          }
        }
      });
      sock.write(getNameMsg(cfg.midiChannel, input));
    });
  } finally {
    sock.end();
  }
}
