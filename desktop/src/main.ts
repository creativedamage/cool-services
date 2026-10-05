/**
 * Sundays — macOS app.
 *
 * Everything runs inside the app: a small server on 127.0.0.1 (never reachable from the network)
 * serves the UI and talks to Planning Center; this window shows it. Signing in happens on
 * Planning Center's own page, which returns to 127.0.0.1 — the same approach ProDeck uses.
 */
import { startClockOutputs } from "./clockOut";
import { startBoardOutput } from "./boardOut";
import { app, BrowserWindow, dialog, Menu, nativeTheme, safeStorage, screen, session, shell } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createUpdater } from "./updater";
import { createEmbed } from "./embed";

// Must match server/src/pco/registration.ts (and the redirect URIs registered with Planning Center).
const PORTS = [47123, 47124, 47125];

app.setName("Sundays");

// Cool Services was renamed Sundays in 1.24. Its data folder (sign-ins, settings, notes, Micboard)
// comes along: ~/Library/Application Support/Cool Services → …/Sundays, the first time.
{
  const appData = app.getPath("appData");
  const before = path.join(appData, "Cool Services");
  const now = path.join(appData, "Sundays");
  let dir = now;
  try {
    if (fs.existsSync(before) && !fs.existsSync(now)) fs.renameSync(before, now);
  } catch {
    dir = before; // couldn't move it: keep using it where it is
  }
  app.setPath("userData", dir);
}

/**
 * The app itself: an update from Cool Services lands as "Cool Services.app"; rename it Sundays.app
 * (once, in place) and start again from there, before any window or helper is open.
 */
function renameBundle(): boolean {
  if (!app.isPackaged || process.platform !== "darwin") return false;
  const bundle = path.resolve(process.execPath, "..", "..", "..");
  if (path.basename(bundle) !== "Cool Services.app") return false;
  const target = path.join(path.dirname(bundle), "Sundays.app");
  try {
    if (fs.existsSync(target)) return false;
    fs.renameSync(bundle, target);
    app.relaunch({ execPath: path.join(target, "Contents", "MacOS", path.basename(process.execPath)) });
    app.exit(0);
    return true;
  } catch {
    return false; // not allowed to rename it (another account's Applications folder): it still works
  }
}

// Never use the macOS Keychain (it asked for the password after every update of the ad hoc-signed
// app). Chromium's own storage then uses a built-in key instead of a Keychain item. The one
// exception is the first launch after updating from a version that kept the sign-in key in the
// Keychain: that launch reads it once and moves it to a file (encryptionKey below).
const KEY_FILE = "key.txt";
const OLD_KEY_FILE = "key.bin";
{
  const dir = app.getPath("userData");
  const migrating = fs.existsSync(path.join(dir, OLD_KEY_FILE)) && !fs.existsSync(path.join(dir, KEY_FILE));
  if (!migrating) app.commandLine.appendSwitch("use-mock-keychain");
}
nativeTheme.themeSource = "system"; // the page picks dark/light from Settings; "System" follows the Mac

let win: BrowserWindow | null = null;
let origin = "";
let embed: ReturnType<typeof createEmbed> | null = null;

if (renameBundle()) {
  // starting again as Sundays.app
} else if (!app.requestSingleInstanceLock()) {
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
 * Key that encrypts saved Planning Center sign-ins: a file only this Mac user can read
 * (~/Library/Application Support/Sundays/key.txt).
 *
 * It used to be kept in the macOS Keychain, but the app is signed ad hoc, so every update looks like
 * a different app to the Keychain and macOS asked for the password again. The first launch of
 * this version reads the old Keychain key one last time (key.bin) and moves it to the file, so
 * nobody has to sign in again; after that the app never touches the Keychain (see below).
 */
function encryptionKey(dir: string): string {
  const file = path.join(dir, KEY_FILE);
  try {
    const k = fs.readFileSync(file, "utf8").trim();
    if (k) return k;
  } catch { /* first time */ }
  let key = "";
  const old = path.join(dir, OLD_KEY_FILE);
  if (fs.existsSync(old)) {
    try {
      const raw = fs.readFileSync(old);
      key = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8");
    } catch { key = ""; } // couldn't read it: a new key (sign in to Planning Center again)
  }
  key ||= crypto.randomBytes(32).toString("base64");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, key, { mode: 0o600 });
  fs.rmSync(old, { force: true });
  return key;
}

function fatal(message: string) {
  dialog.showErrorBox("Sundays couldn’t start", message);
  app.quit();
}

async function boot() {
  const dataDir = app.getPath("userData"); // ~/Library/Application Support/Sundays
  let port: number | undefined;
  for (const p of PORTS) if (await portFree(p)) { port = p; break; }
  if (!port) return fatal(`Ports ${PORTS.join(", ")} are all in use. Quit other copies of Sundays and try again.`);

  origin = `http://127.0.0.1:${port}`;
  // The server reads its settings from the environment when it loads, so set them first.
  process.env.APP_URL = origin;
  process.env.DATA_DIR = dataDir;
  process.env.TOKEN_ENCRYPTION_KEY = encryptionKey(dataDir);
  process.env.NODE_ENV = "production";
  process.env.APP_VERSION = app.getVersion();
  // Micboard's runtime: Contents/Resources/micboard in the app, desktop/micboard-runtime when developing.
  process.env.COOL_MICBOARD_NATIVE = app.isPackaged ? path.join(process.resourcesPath, "micboard") : path.join(__dirname, "..", "micboard-runtime");

  // Start from a clean page cache so an updated app always shows its new screens.
  await session.defaultSession.clearCache();

  // Our own pages may use anything they ask for (MIDI for Waves SuperRack, clipboard…);
  // other sites (Planning Center's sign-in) get no extra permissions.
  const ours = (url?: string) => { try { return new URL(url ?? "").origin === origin; } catch { return false; } };
  session.defaultSession.setPermissionRequestHandler((wc, _perm, cb, details) => cb(ours(details.requestingUrl ?? wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((_wc, _perm, requestingOrigin) => ours(requestingOrigin));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startServer, setUpdateBridge, setEmbedBridge, setPrefsOpener, setAttentionBridge, setCompanionWindowBridge, setFolderOpener, clockOutputs, boardOutputs } = require("./server.cjs") as typeof import("../../server/src/app");
  await startServer({ port, webDir: path.join(__dirname, "web") });
  // Production clock: NDI output and the second-display window.
  startClockOutputs(origin, clockOutputs);
  // Stage display (mic board / clock) on a second display.
  startBoardOutput(origin, boardOutputs);

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
  setPrefsOpener((section) => openPreferences(section));
  setFolderOpener((dir) => { fs.mkdirSync(dir, { recursive: true }); void shell.openPath(dir); });
  // FOH companion: a page request takes over the screen until someone answers it.
  setAttentionBridge((on) => attention(on));
  // FOH companion: the mic strip along the bottom of the screen between page requests.
  setCompanionWindowBridge({ strip: (s) => { stripCfg = s; layoutStrip(); }, open: (view) => openCompanion(view) });
  updater.start();
  buildMenu(updater);

  createWindow();
}

/** "owner/repo" from package.json → sundays.updateRepo (set with `npm run set-repo`). */
function updateRepo(): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"));
    const r = String(pkg.sundays?.updateRepo ?? "");
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
    await dialog.showMessageBox(parent!, { type: "info", message: "You’re up to date", detail: `Sundays ${st.current} is the newest version.` });
  } else if (st.state === "available" && st.latest) {
    const notes = st.latest.notes.length > 600 ? `${st.latest.notes.slice(0, 600)}…` : st.latest.notes;
    const r = await dialog.showMessageBox(parent!, {
      type: "info",
      message: `Sundays ${st.latest.version} is available`,
      detail: `You have ${st.current}.${notes ? `\n\n${notes}` : ""}\n\nUpdating downloads it, restarts Sundays and keeps all your settings.`,
      buttons: ["Update Now", "Later", "What’s New"],
      defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) {
      if (st.installProblem) return void dialog.showMessageBox(parent!, { type: "warning", message: "Can’t update here", detail: st.installProblem });
      openPreferences("updates");
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
        { label: "Preferences…", accelerator: "CmdOrCtrl+,", click: () => openPreferences() },
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

/** Preferences in their own window (Sundays → Preferences…). One at a time. */
let prefsWin: BrowserWindow | null = null;
function openPreferences(section = "") {
  if (!origin) return;
  const url = `${origin}/preferences${section ? `#${section}` : ""}`;
  if (prefsWin) {
    if (section) void prefsWin.webContents.executeJavaScript(`location.hash = ${JSON.stringify(section)}`);
    prefsWin.show(); prefsWin.focus();
    return;
  }
  prefsWin = new BrowserWindow({
    width: 980, height: 720, minWidth: 820, minHeight: 560,
    title: "Preferences", backgroundColor: "#0A0C10", show: false,
    fullscreenable: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  prefsWin.once("ready-to-show", () => prefsWin?.show());
  prefsWin.webContents.setWindowOpenHandler(({ url: u }) => { void shell.openExternal(u); return { action: "deny" }; });
  prefsWin.webContents.on("will-navigate", (e, u) => {
    // Preferences stay on their own page; anything else opens in the main window or the browser.
    const same = u.startsWith(`${origin}/preferences`);
    if (same) return;
    e.preventDefault();
    if (u.startsWith(origin)) { show(u.slice(origin.length)); } else void shell.openExternal(u);
  });
  void prefsWin.loadURL(url);
  prefsWin.on("closed", () => { prefsWin = null; });
}

/* ───────────── FOH companion mic strip ───────────── */

let strip: BrowserWindow | null = null;
let stripCfg: { on: boolean; size: "s" | "m" | "l"; displayId: number | null; displayLabel?: string | null; tuning?: boolean } = { on: false, size: "m", displayId: null };
let attentionOn = false;
let fullOpen = false; // the companion window opened from the strip (settings, held requests)
let quitting = false;
let hiddenForStrip = false; // the main window is hidden because the strip is showing
app.on("before-quit", () => { quitting = true; });
const STRIP_H = { s: 120, m: 170, l: 230 } as const;
/** The Tuning strip above the mics. */
const TUNING_H = { s: 62, m: 74, l: 88 } as const;
/** The display you chose (found again by name if macOS renumbers displays), else the main one. */
function stripDisplay() {
  const all = screen.getAllDisplays();
  const label = (d: Electron.Display, i: number) => `${(d as { label?: string }).label || `Display ${i + 1}`} · ${d.size.width}×${d.size.height}`;
  return all.find((d) => d.id === stripCfg.displayId)
    ?? (stripCfg.displayLabel ? all.find((d, i) => label(d, i) === stripCfg.displayLabel) : undefined)
    ?? screen.getPrimaryDisplay();
}
/** The strip is showing instead of the main window. */
const stripActive = () => stripCfg.on && !attentionOn && !fullOpen;

/**
 * A short, always-on-top bar across the bottom of the chosen display (above the Dock). Only that
 * bar is a window, so everything above it (Waves SuperRack, the console app) stays clickable.
 */
function layoutStrip() {
  if (!stripActive()) {
    strip?.hide();
    // The strip was turned off (or this Mac went back to the full app): the window comes back.
    if (hiddenForStrip && !attentionOn) { hiddenForStrip = false; win?.show(); }
    return;
  }
  const display = stripDisplay();
  const wa = display.workArea;
  const h = (STRIP_H[stripCfg.size] ?? STRIP_H.m) + (stripCfg.tuning === false ? 0 : TUNING_H[stripCfg.size] ?? TUNING_H.m);
  const bounds = { x: wa.x, y: wa.y + wa.height - h, width: wa.width, height: h };
  if (!strip || strip.isDestroyed()) {
    strip = new BrowserWindow({
      // A non-activating panel: pressing a Tuning key or looking at the mics never takes the
      // keyboard or focus away from the app you're working in (SuperRack, the console).
      ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
      ...bounds, frame: false, transparent: true, backgroundColor: "#00000000", hasShadow: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false, title: "Mic strip", acceptFirstMouse: true,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    strip.setAlwaysOnTop(true, "floating");
    strip.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    void strip.loadURL(`${origin}/companion/strip`);
    strip.once("ready-to-show", () => { if (stripActive()) strip?.showInactive(); });
    strip.on("closed", () => { strip = null; });
  } else {
    strip.setBounds(bounds);
    if (!strip.isVisible()) strip.showInactive();
  }
  // The full companion window steps aside while the strip shows.
  if (win?.isVisible()) win.hide();
  if (win) hiddenForStrip = true;
}
for (const ev of ["display-added", "display-removed", "display-metrics-changed"] as const) {
  app.whenReady().then(() => screen.on(ev as "display-added", () => layoutStrip())).catch(() => undefined);
}

/** From the strip's gear (or the companion window's "Back to the mic strip"). */
function openCompanion(view: "full" | "strip") {
  fullOpen = view === "full";
  if (fullOpen) {
    strip?.hide();
    if (!win && origin) createWindow();
    if (win && !win.webContents.getURL().includes("/companion")) void win.loadURL(`${origin}/companion`);
    hiddenForStrip = false;
    win?.show(); win?.focus(); app.focus({ steal: true });
  } else layoutStrip();
}

/** Bring the window over everything (FOH companion page request), or let it go back to normal. */
function attention(on: boolean) {
  attentionOn = on;
  if (on) strip?.hide();
  if (!win && origin) createWindow();
  const w = win;
  if (!w) return;
  if (on) {
    if (w.isMinimized()) w.restore();
    if (!w.webContents.getURL().includes("/companion")) void w.loadURL(`${origin}/companion`);
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.setAlwaysOnTop(true, "screen-saver");
    w.setSimpleFullScreen(true);
    w.show();
    w.focus();
    app.focus({ steal: true });
  } else {
    w.setSimpleFullScreen(false);
    w.setAlwaysOnTop(false);
    w.setVisibleOnAllWorkspaces(false);
    // Answered: back to how it looked before (the mic strip, if it's on).
    if (stripActive()) setTimeout(layoutStrip, 350); // after leaving full screen
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "Sundays",
    backgroundColor: "#0A0C10",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => { if (stripActive()) hiddenForStrip = true; else win?.show(); });
  // FOH companion with the mic strip: closing the window goes back to the strip (Quit still quits).
  win.on("close", (e) => {
    if (quitting || !stripCfg.on) return;
    e.preventDefault();
    fullOpen = false;
    win?.hide();
    hiddenForStrip = true;
    layoutStrip();
  });

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
  win.on("closed", () => { win = null; prefsWin?.close(); });
}

app.on("activate", () => {
  if (stripActive()) openCompanion("full"); // the Dock icon opens the companion window from the strip
  else if (!win && origin) createWindow();
});
app.on("window-all-closed", () => app.quit()); // closing the main window also closes Preferences (above)
