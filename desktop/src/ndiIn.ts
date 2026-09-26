/**
 * Watching NDI sources (ProPresenter's side screen and confidence monitor outputs) on the dashboard.
 *
 * In ProPresenter, each screen can also be sent as NDI. Cool Services finds those sources, receives
 * them at NDI's low-bandwidth preview quality, and turns frames into small JPEGs (about 5 a second)
 * that the dashboard shows. A source is only received while something is looking at it.
 */
import { nativeImage } from "electron";
import type { NdiViewerBridge } from "../../shared/ndiView";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Grandiose = any;

const IDLE_MS = 8_000; // stop receiving a source this long after the last viewer asked for it
const FRAME_MS = 180; // ≈5–6 frames a second is plenty for a preview

function load(): { lib: Grandiose | null; error?: string } {
  if (process.env.COOL_NDI_FAKE) return { lib: "fake" };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return { lib: require("@stagetimerio/grandiose") };
  } catch (e) {
    return { lib: null, error: `NDI isn’t included in this build (${(e as Error).message.split("\n")[0]})` };
  }
}

/** A moving test picture, for trying the dashboard without NDI hardware (COOL_NDI_FAKE). */
function fakeFrame(name: string, t: number): Buffer {
  const w = 640, h = 360, buf = Buffer.alloc(w * h * 4);
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 255;
  const bar = Math.floor((t / 20) % w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const on = Math.abs(x - bar) < 8;
    buf[i] = on ? 255 : (hue + y / 3) % 255; buf[i + 1] = on ? 255 : (x / 3) % 255; buf[i + 2] = on ? 255 : 90; buf[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(buf, { width: w, height: h }).toJPEG(70);
}

export function createNdiViewer(): NdiViewerBridge {
  const { lib, error } = load();
  let finder: any = null;
  const live = new Map<string, { jpeg: Buffer | null; at: number; lastAsked: number; stop: boolean; size: string }>();

  async function sources(): Promise<{ name: string }[]> {
    if (!lib) throw new Error(error);
    if (lib === "fake") return [{ name: "TEST-MAC (Side Screens)" }, { name: "TEST-MAC (Confidence 1)" }, { name: "TEST-MAC (Confidence 2)" }];
    finder ??= await lib.find({ showLocalSources: true });
    await finder.wait?.(800).catch?.(() => {});
    return (finder.sources() as { name: string }[]).map((s) => ({ name: s.name }));
  }

  async function receiveLoop(name: string) {
    const st = live.get(name)!;
    if (lib === "fake") {
      while (!st.stop) {
        if (Date.now() - st.lastAsked > IDLE_MS) break;
        st.jpeg = fakeFrame(name, Date.now()); st.at = Date.now(); st.size = "640×360";
        await new Promise((r) => setTimeout(r, FRAME_MS));
      }
      live.delete(name);
      return;
    }
    try {
      const all = await sources();
      const src = all.find((s) => s.name === name);
      if (!src) throw new Error("not found");
      // BGRX/BGRA at NDI's lowest bandwidth (its preview stream).
      const recv = await lib.receive({ source: (finder.sources() as { name: string }[]).find((s) => s.name === name), colorFormat: 0, bandwidth: 0, allowVideoFields: false, name: "Cool Services preview" });
      while (!st.stop && Date.now() - st.lastAsked < IDLE_MS) {
        let f: { xres: number; yres: number; lineStrideBytes: number; data: Buffer } | null = null;
        try { f = await recv.video(1000); } catch { continue; } // no frame within a second: keep waiting
        if (!f?.data) continue;
        if (Date.now() - st.at < FRAME_MS) continue;
        const { xres: w, yres: h } = f;
        let data = f.data;
        if (f.lineStrideBytes && f.lineStrideBytes !== w * 4) {
          data = Buffer.alloc(w * h * 4);
          for (let y = 0; y < h; y++) f.data.copy(data, y * w * 4, y * f.lineStrideBytes, y * f.lineStrideBytes + w * 4);
        }
        let img = nativeImage.createFromBitmap(data, { width: w, height: h });
        if (w > 960) img = img.resize({ width: 960 });
        st.jpeg = img.toJPEG(72); st.at = Date.now(); st.size = `${w}×${h}`;
      }
    } catch (e) {
      console.log(`[ndi] ${name}: ${(e as Error).message}`);
    }
    live.delete(name);
  }

  return {
    available: () => (lib ? { ok: true } : { ok: false, error }),
    sources,
    /** The newest frame of a source (starts receiving it if needed). */
    frame(name: string) {
      if (!lib) return null;
      let st = live.get(name);
      if (!st) {
        st = { jpeg: null, at: 0, lastAsked: Date.now(), stop: false, size: "" };
        live.set(name, st);
        void receiveLoop(name);
      }
      st.lastAsked = Date.now();
      return st.jpeg ? { jpeg: st.jpeg, at: st.at, size: st.size } : null;
    },
  };
}
