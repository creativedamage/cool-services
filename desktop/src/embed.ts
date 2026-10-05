/**
 * Planning Center Chat inside the Sundays window.
 *
 * Planning Center has no public Chat API, so Sundays shows Planning Center's own Chat
 * (chat.planningcenteronline.com) in a native view placed over the Chat page's content area. It
 * uses the same browser session as the rest of the app, so the Planning Center sign-in from
 * "Sign in with Planning Center" usually carries over. Links that leave Planning Center open in the
 * default browser.
 */
import { shell, WebContentsView, type BrowserWindow } from "electron";
import type { EmbedBridge, EmbedRequest } from "../../shared/embed";

const isPco = (url: string) => {
  try { const u = new URL(url); return u.protocol === "https:" && (u.hostname === "planningcenteronline.com" || u.hostname.endsWith(".planningcenteronline.com")); } catch { return false; }
};

export function createEmbed(getWin: () => BrowserWindow | null): EmbedBridge {
  let view: WebContentsView | null = null;
  let attachedTo: BrowserWindow | null = null;
  let home = "https://chat.planningcenteronline.com/";

  const make = () => {
    const v = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    v.setBackgroundColor("#0A0C10");
    v.webContents.setWindowOpenHandler(({ url }) => {
      if (isPco(url)) void v.webContents.loadURL(url); else void shell.openExternal(url);
      return { action: "deny" };
    });
    v.webContents.on("will-navigate", (e, url) => { if (!isPco(url)) { e.preventDefault(); void shell.openExternal(url); } });
    return v;
  };

  const detach = () => {
    if (view && attachedTo && !attachedTo.isDestroyed()) attachedTo.contentView.removeChildView(view);
    attachedTo = null;
  };

  return {
    apply(req: EmbedRequest) {
      const win = getWin();
      if (!win || win.isDestroyed()) return { ok: false, url: null };
      if (req.action === "hide") { detach(); return { ok: true, url: view?.webContents.getURL() ?? null }; }
      if (!view) view = make();
      if (req.action === "reload") { view.webContents.reload(); return { ok: true, url: view.webContents.getURL() }; }
      if (req.action === "home") { void view.webContents.loadURL(home); return { ok: true, url: home }; }

      // show
      if (req.url && req.url !== home) { home = req.url; void view.webContents.loadURL(home); }
      else if (!view.webContents.getURL()) void view.webContents.loadURL(home);
      if (attachedTo !== win) { detach(); win.contentView.addChildView(view); attachedTo = win; }
      if (req.bounds) {
        // The page reports CSS pixels; the window may be zoomed (View → Zoom In).
        const z = win.webContents.getZoomFactor();
        const b = req.bounds;
        view.setBounds({ x: Math.round(b.x * z), y: Math.round(b.y * z), width: Math.max(0, Math.round(b.width * z)), height: Math.max(0, Math.round(b.height * z)) });
      }
      return { ok: true, url: view.webContents.getURL() || home };
    },
  };
}
