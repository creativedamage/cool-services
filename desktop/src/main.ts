/**
 * Cool Services — macOS app.
 *
 * Everything runs inside the app: a small server on 127.0.0.1 (never reachable from the network)
 * serves the UI and talks to Planning Center; this window shows it. Signing in happens on
 * Planning Center's own page, which returns to 127.0.0.1 — the same approach ProDeck uses.
 */
import { app, BrowserWindow, dialog, Menu, nativeTheme, safeStorage, session, shell } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { startNdi } from "./ndi";
import { createUpdater } from "./updater";
import { createEmbed } from "./embed";

// Must match server/src/pco/registration.ts (and the redirect URIs registered with Planning Center).
const PORTS = [47123, 47124, 47125];

app.setName("Cool Services");
nativeTheme.themeSource = "system"; // the page picks dark/light from Settings; "System" follows the Mac

let win: BrowserWindow | null = null;
let origin = "";
let embed: ReturnType<typeof createEmbed> | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(boot).catch((e) => fatal(String(e?.stack ?? e)));
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

/**
 * Key that encrypts saved Planning Center sign-ins. Kept in the macOS Keychain via safeStorage,
 * so the data file alone is useless if copied off the Mac.
 */
function encryptionKey(dir: string): string {
  const file = path.join(dir, "key.bin");
  const canEncrypt = safeStorage.isEncryptionAvailable();
  try {
    const raw = fs.readFileSync(file);
    return canEncrypt ? safeStorage.decryptString(raw) : raw.toString("utf8");
  } catch {
    const key = crypto.randomBytes(32).toString("base64");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, canEncrypt ? safeStorage.encryptString(key) : Buffer.from(key), { mode: 0o600 });
    return key;
  }
}

function fatal(message: string) {
  dialog.showErrorBox("Cool Services couldn’t start", message);
  app.quit();
}

async function boot() {
  const dataDir = app.getPath("userData"); // ~/Library/Application Support/Cool Services
  let port: number | undefined;
  for (const p of PORTS) if (await portFree(p)) { port = p; break; }
  if (!port) return fatal(`Ports ${PORTS.join(", ")} are all in use. Quit other copies of Cool Services and try again.`);

  origin = `http://127.0.0.1:${port}`;
  // The server reads its settings from the environment when it loads, so set them first.
  process.env.APP_URL = origin;
  process.env.DATA_DIR = dataDir;
  process.env.TOKEN_ENCRYPTION_KEY = encryptionKey(dataDir);
  process.env.NODE_ENV = "production";
  process.env.APP_VERSION = app.getVersion();

  // Start from a clean page cache so an updated app always shows its new screens.
  await session.defaultSession.clearCache();

  // Our own pages may use anything they ask for (MIDI for Waves SuperRack, clipboard…);
  // other sites (Planning Center's sign-in) get no extra permissions.
  const ours = (url?: string) => { try { return new URL(url ?? "").origin === origin; } catch { return false; } };
  session.defaultSession.setPermissionRequestHandler((wc, _perm, cb, details) => cb(ours(details.requestingUrl ?? wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((_wc, _perm, requestingOrigin) => ours(requestingOrigin));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startServer, ndiBridge, setUpdateBridge, setEmbedBridge } = require("./server.cjs") as typeof import("../../server/src/app");
  await startServer({ port, webDir: path.join(__dirname, "web") });

  // Check for Updates (GitHub Releases). Only the packaged app can replace itself.
  const updater = createUpdater({
    currentVersion: app.getVersion(),
    repo: process.env.COOL_UPDATE_REPO || updateRepo(),
    apiBase: process.env.COOL_UPDATE_API, // tests only
    appBundle: app.isPackaged ? path.resolve(process.execPath, "..", "..", "..") : "",
    quit: () => app.quit(),
    log: (m) => console.log(`[updates] ${m}`),
  });
  setUpdateBridge(updater);
  embed = createEmbed(() => win); // Planning Center Chat inside the window
  setEmbedBridge(embed);
  updater.start();
  buildMenu(updater);

  createWindow();
  startNdi(origin, ndiBridge); // stage plot → NDI, controlled from Settings
}

/** "owner/repo" from package.json → coolServices.updateRepo (set with `npm run set-repo`). */
function updateRepo(): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"));
    const r = String(pkg.coolServices?.updateRepo ?? "");
    return /^[\w.-]+\/[\w.-]+$/.test(r) && !r.startsWith("YOUR-") ? r : null;
  } catch {
    return null;
  }
}

type Updater = ReturnType<typeof createUpdater>;

/** Show a page of the app (e.g. Settings → Updates). */
function show(page: string) {
  if (!win && origin) createWindow();
  if (win) { void win.loadURL(`${origin}${page}`); win.show(); win.focus(); }
}

async function checkFromMenu(updater: Updater) {
  const st = await updater.check();
  const parent = win ?? undefined;
  if (st.state === "up-to-date") {
    await dialog.showMessageBox(parent!, { type: "info", message: "You’re up to date", detail: `Cool Services ${st.current} is the newest version.` });
  } else if (st.state === "available" && st.latest) {
    const notes = st.latest.notes.length > 600 ? `${st.latest.notes.slice(0, 600)}…` : st.latest.notes;
    const r = await dialog.showMessageBox(parent!, {
      type: "info",
      message: `Cool Services ${st.latest.version} is available`,
      detail: `You have ${st.current}.${notes ? `\n\n${notes}` : ""}\n\nUpdating downloads it, restarts Cool Services and keeps all your settings.`,
      buttons: ["Update Now", "Later", "What’s New"],
      defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) {
      if (st.installProblem) return void dialog.showMessageBox(parent!, { type: "warning", message: "Can’t update here", detail: st.installProblem });
      show("/settings#updates");
      void updater.install();
    } else if (r.response === 2) {
      void shell.openExternal(st.latest.url);
    }
  } else if (st.state === "error" || st.state === "unavailable") {
    await dialog.showMessageBox(parent!, { type: "warning", message: "Couldn’t check for updates", detail: st.error ?? "Try again later." });
  }
}

function buildMenu(updater: Updater) {
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { label: "Check for Updates…", click: () => void checkFromMenu(updater) },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => show("/settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(menu);
}

/** Stay inside the app for our pages and Planning Center's sign-in; open everything else in the browser. */
function isInApp(url: string) {
  try {
    const u = new URL(url);
    return u.origin === origin || u.hostname === "planningcenteronline.com" || u.hostname.endsWith(".planningcenteronline.com");
  } catch {
    return false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "Cool Services",
    backgroundColor: "#0A0C10",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => win?.show());

  // New windows (links with target=_blank, "Open in Planning Center") go to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  // mailto:, tel: and other sites open outside the app.
  win.webContents.on("will-navigate", (e, url) => {
    if (!isInApp(url)) { e.preventDefault(); void shell.openExternal(url); }
  });

  // A full page load (not the app's own in-page navigation) always takes Chat off the screen.
  win.webContents.on("did-navigate", () => embed?.apply({ action: "hide" }));

  void win.loadURL(`${origin}/`);
  win.on("closed", () => { win = null; });
}

app.on("activate", () => { if (!win && origin) createWindow(); });
app.on("window-all-closed", () => app.quit());
