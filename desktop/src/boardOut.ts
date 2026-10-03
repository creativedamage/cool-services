/**
 * The stage display (mic board / stage plot / clock) full screen on another display of this Mac.
 * Settings come from the server (Mic board → Display settings); the list of displays goes back.
 */
import { BrowserWindow, screen } from "electron";
import type { BoardSettings } from "../../shared/board";

interface Bridge {
  settings: () => BoardSettings;
  onSettings: (fn: (s: BoardSettings) => void) => void;
  setDisplays: (d: { id: number; label: string; primary: boolean }[]) => void;
}

export function startBoardOutput(origin: string, bridge: Bridge) {
  let win: BrowserWindow | null = null;
  let current = "";
  const list = () => {
    const primary = screen.getPrimaryDisplay().id;
    bridge.setDisplays(screen.getAllDisplays().map((d, i) => ({
      id: d.id, primary: d.id === primary, label: `${(d as { label?: string }).label || `Display ${i + 1}`} · ${d.size.width}×${d.size.height}`,
    })));
  };
  function apply(s: BoardSettings) {
    const display = screen.getAllDisplays().find((d) => d.id === s.screen.displayId) ?? null;
    const key = `${s.screen.enabled}:${display?.id}:${JSON.stringify(display?.bounds)}`;
    if (key === current) return;
    current = key;
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    if (!s.screen.enabled || !display) return;
    const b = display.bounds;
    win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height, frame: false, backgroundColor: "#000000", show: false, skipTaskbar: true, title: "Stage display",
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    win.setBounds(b);
    void win.loadURL(`${origin}/displayout`);
    win.once("ready-to-show", () => {
      if (!win) return;
      if (display.id !== screen.getPrimaryDisplay().id) win.setSimpleFullScreen(true);
      win.showInactive();
    });
    win.on("closed", () => { win = null; current = ""; });
  }
  list();
  for (const ev of ["display-added", "display-removed", "display-metrics-changed"] as const) {
    screen.on(ev as "display-added", () => { list(); apply(bridge.settings()); });
  }
  apply(bridge.settings());
  bridge.onSettings(apply);
}
