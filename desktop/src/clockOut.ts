/**
 * Production clock outputs that need the Mac app:
 *  - NDI®: an invisible off-screen window renders /clockout?ndi=1 at 1080p or 720p; each frame
 *    goes out as BGRA (see-through background) or BGRX video through the NDI library.
 *  - A full-screen clock window on another display.
 * Settings come from the server (Preferences → Video → Clock outputs); status goes back to it.
 */
import { BrowserWindow, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ClockOutputSettings, ClockStatusView } from "../../shared/clock";
import { loadNdi, type NdiSender } from "./ndiLib";

interface Bridge {
  settings: () => ClockOutputSettings;
  onSettings: (fn: (s: ClockOutputSettings) => void) => void;
  setStatus: (s: { ndi?: Partial<ClockStatusView["ndi"]>; displays?: ClockStatusView["displays"] }) => void;
}

const SIZES = { "720p": [1280, 720], "1080p": [1920, 1080] } as const;

/** COOL_NDI_FAKE=<folder>: no NDI library needed; writes a couple of frames as PNGs (tests). */
function fakeSender(dir: string, name: string): NdiSender {
  let n = 0;
  return {
    async video(f) {
      n++;
      if (n === 5 || n === 60) {
        const { nativeImage } = await import("electron");
        fs.writeFileSync(path.join(dir, `clock-frame-${n}.png`), nativeImage.createFromBitmap(f.data, { width: f.width, height: f.height }).toPNG());
        fs.writeFileSync(path.join(dir, "clock-frames.txt"), `${n} frames ${f.width}x${f.height} alpha=${f.alpha} ${f.data.length} bytes\n`);
      }
    },
    connections: () => 1, sourceName: () => `TEST-MAC (${name})`, destroy() {},
  };
}

export function startClockOutputs(origin: string, bridge: Bridge) {
  /* ── NDI ── */
  const fake = process.env.COOL_NDI_FAKE;
  const loaded = fake ? { ndi: { createSender: (name: string) => fakeSender(fake, name) }, error: undefined } : loadNdi();
  bridge.setStatus({ ndi: { available: Boolean(loaded.ndi), running: false, sourceName: null, connections: 0, error: loaded.error } });
  if (loaded.error) console.log(`[clock] ${loaded.error}`);

  let sender: NdiSender | null = null;
  let off: BrowserWindow | null = null;
  let frame: Buffer | null = null;
  let timers: NodeJS.Timeout[] = [];
  let currentNdi = "";

  function stopNdi() {
    timers.forEach(clearInterval);
    timers = [];
    frame = null;
    if (off && !off.isDestroyed()) off.destroy();
    off = null;
    sender?.destroy();
    sender = null;
  }

  async function applyNdi(s: ClockOutputSettings) {
    const key = JSON.stringify(s.ndi);
    if (key === currentNdi) return;
    currentNdi = key;
    stopNdi();
    if (!s.ndi.enabled || !loaded.ndi) {
      bridge.setStatus({ ndi: { running: false, sourceName: null, connections: 0, error: s.ndi.enabled ? loaded.error : undefined } });
      return;
    }
    const [w, h] = SIZES[s.ndi.resolution];
    const fps = s.ndi.fps;
    const alpha = s.ndi.transparent;
    try {
      sender = loaded.ndi.createSender(s.ndi.name);
      off = new BrowserWindow({
        show: false, width: w, height: h, useContentSize: true, frame: false, enableLargerThanScreen: true,
        transparent: alpha, backgroundColor: alpha ? "#00000000" : "#000000",
        webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, backgroundThrottling: false },
      });
      off.webContents.setFrameRate(fps);
      off.webContents.on("paint", (_e, _dirty, image) => {
        const size = image.getSize();
        frame = (size.width === w && size.height === h ? image : image.resize({ width: w, height: h })).toBitmap(); // BGRA, top-down
      });
      off.webContents.on("render-process-gone", () => { currentNdi = ""; void applyNdi(bridge.settings()); });
      await off.loadURL(`${origin}/clockout?ndi=1`);

      // A steady stream at the chosen rate (receivers expect one even when nothing moves).
      let sending = false;
      timers.push(setInterval(() => {
        if (!frame || !sender || sending) return;
        sending = true;
        sender.video({ width: w, height: h, fps, alpha, data: frame }).catch(() => {}).finally(() => { sending = false; });
      }, 1000 / fps));
      timers.push(setInterval(() => bridge.setStatus({ ndi: { connections: sender?.connections() ?? 0 } }), 1000));
      timers.push(setInterval(() => off?.webContents.invalidate(), 1000));
      bridge.setStatus({ ndi: { running: true, sourceName: sender.sourceName(), error: undefined } });
      console.log(`[clock] NDI source “${sender.sourceName()}” ${w}x${h} @ ${fps}${alpha ? " with alpha" : ""}`);
    } catch (e) {
      bridge.setStatus({ ndi: { running: false, sourceName: null, error: `Couldn’t start NDI: ${(e as Error).message}` } });
      stopNdi();
    }
  }

  /* ── Second display ── */
  let screenWin: BrowserWindow | null = null;
  let currentScreen = "";
  const listDisplays = () => {
    const primary = screen.getPrimaryDisplay().id;
    bridge.setStatus({
      displays: screen.getAllDisplays().map((d, i) => ({
        id: d.id, primary: d.id === primary,
        label: `${(d as { label?: string }).label || `Display ${i + 1}`} · ${d.size.width}×${d.size.height}`,
      })),
    });
  };
  function applyScreen(s: ClockOutputSettings, force = false) {
    const display = screen.getAllDisplays().find((d) => d.id === s.screen.displayId) ?? null;
    const key = `${s.screen.enabled}:${display?.id}:${JSON.stringify(display?.bounds)}`;
    if (key === currentScreen && !force) return;
    currentScreen = key;
    if (screenWin && !screenWin.isDestroyed()) screenWin.destroy();
    screenWin = null;
    if (!s.screen.enabled || !display) return;
    const b = display.bounds;
    screenWin = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height, frame: false, backgroundColor: "#000000", show: false,
      fullscreenable: true, skipTaskbar: true, title: "Clock",
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    screenWin.setBounds(b);
    void screenWin.loadURL(`${origin}/clockout`);
    screenWin.once("ready-to-show", () => {
      if (!screenWin) return;
      // The main display: a normal window (full screen would hide everything else). Others: full screen.
      if (display.id !== screen.getPrimaryDisplay().id) screenWin.setSimpleFullScreen(true);
      screenWin.showInactive();
    });
    screenWin.on("closed", () => { screenWin = null; });
  }

  listDisplays();
  for (const ev of ["display-added", "display-removed", "display-metrics-changed"] as const) {
    screen.on(ev as "display-added", () => { listDisplays(); applyScreen(bridge.settings()); });
  }

  let busy = Promise.resolve();
  const apply = (s: ClockOutputSettings) => { busy = busy.then(() => applyNdi(s)).catch(() => {}); applyScreen(s); };
  apply(bridge.settings());
  bridge.onSettings(apply);
}
