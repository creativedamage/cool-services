/**
 * NDI® output of the stage plot.
 *
 * An invisible off-screen window renders /ndi (the next service's stage plot) at the chosen
 * resolution; each frame is sent as BGRA video with the NDI SDK (via @stagetimerio/grandiose).
 * Receivers such as ProPresenter see it as "<MAC NAME> (<name from Settings>)".
 *
 * NDI is optional: if the native module isn't in this build (e.g. it couldn't compile), the rest
 * of the app works and Settings says NDI isn't available.
 * NDI® is a registered trademark of Vizrt NDI AB — https://ndi.video
 */
import { BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { NdiSettings, NdiStatus } from "../../shared/types";
import { loadGrandiose } from "./ndiLib";

interface Bridge {
  settings: () => NdiSettings;
  onSettings: (fn: (s: NdiSettings) => void) => void;
  setStatus: (s: Partial<NdiStatus>) => void;
}

const SIZES: Record<NdiSettings["resolution"], [number, number]> = { "720p": [1280, 720], "1080p": [1920, 1080], "4k": [3840, 2160] };

/* eslint-disable @typescript-eslint/no-explicit-any */
function loadNdi(): { lib: any; error?: string } {
  // For testing without NDI hardware: COOL_NDI_FAKE=<folder> writes a few frames as PNGs instead.
  const fake = process.env.COOL_NDI_FAKE;
  if (fake) {
    let n = 0;
    return {
      lib: {
        FOURCC_BGRA: 0, FORMAT_TYPE_PROGRESSIVE: 1,
        send: async ({ name }: { name: string }) => ({
          sourcename: () => `TEST-MAC (${name})`,
          connections: () => 1,
          destroy: async () => {},
          video: async (f: { xres: number; yres: number; data: Buffer }) => {
            n++;
            if (n === 3 || n === 30) {
              const { nativeImage } = await import("electron");
              fs.writeFileSync(path.join(fake, `frame-${n}.png`), nativeImage.createFromBitmap(f.data, { width: f.xres, height: f.yres }).toPNG());
              fs.writeFileSync(path.join(fake, "frames.txt"), `${n} frames ${f.xres}x${f.yres} ${f.data.length} bytes\n`);
            }
          },
        }),
      },
    };
  }
  return loadGrandiose();
}

export function startNdi(origin: string, bridge: Bridge) {
  const { lib, error } = loadNdi();
  bridge.setStatus({ available: Boolean(lib), error });
  if (!lib) return;

  let sender: any = null;
  let win: BrowserWindow | null = null;
  let frame: Buffer | null = null;
  let timers: NodeJS.Timeout[] = [];
  let current = "";
  let busy = Promise.resolve();

  async function stop() {
    timers.forEach(clearInterval);
    timers = [];
    frame = null;
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    if (sender) await sender.destroy().catch(() => {});
    sender = null;
  }

  async function apply(s: NdiSettings) {
    const key = JSON.stringify(s);
    if (key === current) return;
    current = key;
    await stop();
    if (!s.enabled) {
      bridge.setStatus({ running: false, sourceName: null, connections: 0, error: undefined });
      return;
    }
    const [w, h] = SIZES[s.resolution];
    try {
      sender = await lib.send({ name: s.name, clockVideo: true });
      win = new BrowserWindow({
        show: false, width: w, height: h, useContentSize: true, frame: false, enableLargerThanScreen: true,
        webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, backgroundThrottling: false },
      });
      win.webContents.setFrameRate(s.fps);
      win.webContents.on("paint", (_e, _dirty, image) => {
        const size = image.getSize();
        frame = (size.width === w && size.height === h ? image : image.resize({ width: w, height: h })).toBitmap(); // BGRA
      });
      win.webContents.on("render-process-gone", () => { current = ""; void apply(bridge.settings()); });
      await win.loadURL(`${origin}/ndi`);

      // NDI receivers want a steady stream: resend the latest frame at the chosen rate.
      let sending = false;
      timers.push(setInterval(async () => {
        if (!frame || !sender || sending) return;
        sending = true;
        try {
          await sender.video({
            xres: w, yres: h, frameRateN: s.fps * 1000, frameRateD: 1000,
            fourCC: lib.FOURCC_BGRA, pictureAspectRatio: w / h, frameFormatType: lib.FORMAT_TYPE_PROGRESSIVE,
            lineStrideBytes: w * 4, data: frame,
          });
        } catch { /* a dropped frame is fine */ } finally { sending = false; }
      }, 1000 / s.fps));
      timers.push(setInterval(() => bridge.setStatus({ connections: sender?.connections?.() ?? 0 }), 1000));
      // Keep the page rendering even when nothing moves, so receivers never time out.
      timers.push(setInterval(() => win?.webContents.invalidate(), 1000));

      bridge.setStatus({ running: true, sourceName: sender.sourcename?.() ?? s.name, width: w, height: h, fps: s.fps, error: undefined });
    } catch (e) {
      bridge.setStatus({ running: false, sourceName: null, error: `Couldn’t start NDI: ${(e as Error).message}` });
      await stop();
    }
  }

  const queue = (s: NdiSettings) => { busy = busy.then(() => apply(s)).catch(() => {}); };
  queue(bridge.settings());
  bridge.onSettings(queue);
}
