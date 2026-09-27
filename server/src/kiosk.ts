/**
 * Kids & Nursery iPad pages.
 *
 * The main app only listens on 127.0.0.1. When "iPads on the church network" is turned on in
 * Settings, a second, much smaller server listens on the network (port 47130 by default). It serves
 * ONLY the iPad page and /api/kiosk: no staff screens, notes, people or plans are reachable from it.
 *
 * Each ministry is locked with its own PIN. An iPad signed in to Nursery can see Nursery's checked-in
 * children (name, photo, security code, room) and page the auditorium; nothing else.
 */
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { z } from "zod";
import { MINISTRIES, type KioskChild, type KioskInfo, type Ministry } from "../../shared/types.js";
import { pcoForUser } from "./auth/oauth.js";
import type { PcoApi } from "./pco/api.js";
import { settings } from "./lib/db.js";
import { kioskSession, onPagingChange, page, PagingError, status, stored, unlock } from "./lib/paging.js";

const cookieName = (m: Ministry) => `cs_ipad_${m}`;
const cookieOpts = { httpOnly: true, sameSite: "strict" as const, path: "/", maxAge: 400 * 864e5 };
const ministryZ = z.enum(MINISTRIES as [Ministry, ...Ministry[]]);

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch((e: unknown) => {
    if (e instanceof PagingError) return res.status(e.status).json({ error: e.code, message: e.message, status: forMinistry(req.params.ministry as Ministry) });
    if (e instanceof z.ZodError) return res.status(400).json({ error: "invalid_request" });
    console.error("[kiosk]", e);
    res.status(500).json({ error: "server_error", message: "Something went wrong. Try again." });
  });

/** The Planning Center access the pages borrow: whoever last saved the iPad settings. */
function ownerPco() {
  const o = stored().owner;
  return o ? pcoForUser(o.userId, o.demo) : null;
}

let churchName: { name: string; at: number } | null = null;
async function church(): Promise<string> {
  if (churchName && Date.now() - churchName.at < 3600e3) return churchName.name;
  const api = ownerPco();
  const name = api ? await api.me().then((m) => m.orgName).catch(() => "") : "";
  churchName = { name, at: Date.now() };
  return name;
}

/** Status for one ministry's iPads: the shared on-screen lock, and only their own recent pages. */
function forMinistry(m: Ministry) {
  const s = status();
  return { ...s, recent: s.recent.filter((e) => e.ministry === m).map(({ by: _by, ...e }) => ({ ...e, by: "" })) };
}

export const kioskRouter = Router();

kioskRouter.use("/:ministry", (req, res, next) => {
  const m = ministryZ.safeParse(req.params.ministry);
  if (!m.success) return res.status(404).json({ error: "not_found" });
  next();
});

const signedIn = (req: Request) => kioskSession(req.params.ministry as Ministry, req.cookies?.[cookieName(req.params.ministry as Ministry)]);
const needIpad = (req: Request, res: Response, next: NextFunction) => {
  if (!signedIn(req)) return res.status(401).json({ error: "locked" });
  if (!stored().config.ministries[req.params.ministry as Ministry].enabled) return res.status(403).json({ error: "disabled" });
  next();
};

kioskRouter.get("/:ministry/info", h(async (req, res) => {
  const m = req.params.ministry as Ministry;
  const cfg = stored().config.ministries[m];
  const info: KioskInfo = { ministry: m, title: cfg.title, church: await church(), logo: settings.get().logo, unlocked: signedIn(req), enabled: cfg.enabled };
  res.json(info);
}));

kioskRouter.post("/:ministry/unlock", h(async (req, res) => {
  const m = req.params.ministry as Ministry;
  const { pin } = z.object({ pin: z.string().max(12) }).parse(req.body);
  const r = unlock(m, pin, req.ip ?? "unknown");
  if ("error" in r) {
    const message = r.error === "no_pin" ? "This page isn't set up yet. Ask a staff member to set a PIN in Cool Services → Settings."
      : r.error === "too_many_tries" ? `Too many tries. Wait ${r.waitSeconds} seconds.` : "That PIN isn't right.";
    return res.status(r.error === "too_many_tries" ? 429 : 401).json({ ...r, message });
  }
  res.cookie(cookieName(m), r.token, cookieOpts);
  res.json({ ok: true });
}));

kioskRouter.post("/:ministry/lock", h(async (req, res) => {
  res.clearCookie(cookieName(req.params.ministry as Ministry), { path: "/" });
  res.json({ ok: true });
}));

/** Children checked in today to this ministry's rooms, still here (not checked out). */
export async function childrenFor(m: Ministry, as?: PcoApi | null): Promise<KioskChild[]> {
  const cfg = stored().config.ministries[m];
  const api = as ?? ownerPco();
  if (!api) throw new PagingError("not_configured", "Ask a staff member to open Cool Services → Settings and save the Kids & Nursery settings.", 503);
  const rooms = new Set(cfg.locationIds);
  if (!rooms.size) return [];
  const rows = await api.getTodayCheckIns();
  return rows
    .filter((r) => r.kind !== "Volunteer" && !r.checkedOutAt && r.locationIds.some((id) => rooms.has(id)))
    .map((r): KioskChild => ({
      id: r.id, name: r.name, avatarUrl: r.avatarUrl, securityCode: r.securityCode,
      room: r.locations.find((_, i) => rooms.has(r.locationIds[i])) ?? r.locations[0] ?? "",
      at: r.at, guest: r.kind === "Guest",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

kioskRouter.get("/:ministry/children", needIpad, h(async (req, res) => {
  res.json({ children: await childrenFor(req.params.ministry as Ministry), fetchedAt: new Date().toISOString() });
}));

kioskRouter.get("/:ministry/status", needIpad, h(async (req, res) => res.json(forMinistry(req.params.ministry as Ministry))));

kioskRouter.post("/:ministry/page", needIpad, h(async (req, res) => {
  const m = req.params.ministry as Ministry;
  const b = z.object({ checkInId: z.string().max(60).optional(), code: z.string().max(20).optional() }).parse(req.body);
  let code = b.code ?? "";
  let childName: string | null = null;
  if (b.checkInId) {
    const child = (await childrenFor(m)).find((c) => c.id === b.checkInId);
    if (!child?.securityCode) return res.status(404).json({ error: "not_found", message: "That child isn't checked in to this room any more." });
    code = child.securityCode;
    childName = child.name;
  }
  const title = stored().config.ministries[m].title;
  await page(m, code, { by: `${title} iPad`, actorId: `ipad:${m}`, childName });
  res.json({ ok: true, status: forMinistry(m) });
}));

/* ───────────── The network listener ───────────── */

let server: Server | null = null;
let listening: { port: number } | null = null;
let lastError: string | undefined;
let webRoot: string | undefined;

export const kioskState = () => ({ running: Boolean(listening), error: lastError });

function createKioskApp() {
  const app = express();
  app.set("trust proxy", false);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cookieParser());
  app.use(express.json({ limit: "10kb" }));
  app.use("/api/kiosk", kioskRouter);
  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));
  if (webRoot && fs.existsSync(webRoot)) {
    const page = path.join(webRoot, "kiosk.html");
    const send = (_req: Request, res: Response) => res.set("Cache-Control", "no-cache").sendFile(page);
    // A friendly address (kids.yourchurch.org) goes straight to that ministry's page.
    app.get("/", (req, res, next) => {
      const host = String(req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "");
      const names = stored().config.ipads.hostnames ?? {};
      const m = MINISTRIES.find((x) => names[x] && names[x] === host)
        ?? MINISTRIES.find((x) => host.split(".")[0] === x); // kids.… / nursery.…
      if (m) return res.redirect(302, `/${m}`);
      next();
    });
    app.get(["/", "/nursery", "/kids"], send);
    // Only what the iPad page needs: its scripts/styles, the PDF-free static bundle and icons.
    app.use("/_next/static", express.static(path.join(webRoot, "_next", "static"), { immutable: true, maxAge: "365d" }));
    for (const f of ["favicon.ico", "icon.png", "apple-touch-icon.png"]) {
      app.get(`/${f}`, (_req, res) => (fs.existsSync(path.join(webRoot!, f)) ? res.sendFile(path.join(webRoot!, f)) : res.status(404).end()));
    }
  }
  app.use((_req, res) => res.status(404).send("Not found"));
  return app;
}

/** Start/stop/move the network listener to match Settings. */
export function applyKiosk() {
  const { enabled, port } = stored().config.ipads;
  const want = enabled ? { port } : null;
  if (listening && want && listening.port === want.port) return;
  if (server) { server.close(); server.closeAllConnections?.(); server = null; listening = null; }
  lastError = undefined;
  if (!want) return;
  const s = createKioskApp().listen(want.port, "0.0.0.0", () => {
    listening = want;
    console.log(`  Kids & Nursery iPad pages on port ${want.port}`);
  });
  s.on("error", (e: NodeJS.ErrnoException) => {
    lastError = e.code === "EADDRINUSE" ? `Port ${want.port} is already in use on this Mac. Choose another in Settings.` : e.message;
    listening = null;
    server = null;
  });
  server = s;
}

export function initKiosk(webDir?: string) {
  webRoot = webDir;
  applyKiosk();
  onPagingChange(applyKiosk);
}
