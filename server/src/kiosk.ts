/**
 * Kids & Nursery iPad pages, Team check-ins on phones (/leads, /staff) and FOH companions.
 *
 * The main app only listens on 127.0.0.1. When "iPads on the church network" is turned on in
 * Settings, a second, much smaller server listens on the network (port 47130 by default). It serves
 * ONLY the iPad page and /api/kiosk: no staff screens, notes, people or plans are reachable from it.
 *
 * Each ministry is locked with its own PIN. An iPad signed in to Nursery can see Nursery's checked-in
 * children (name, photo, security code, room) and page the auditorium; nothing else.
 */
import { weekendPlans } from "./lib/weekend.js";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { z } from "zod";
import { MINISTRIES, type KioskChild, type KioskInfo, type Ministry, type TeamGroup, type TeamPhoneData, type TeamPhoneInfo } from "../../shared/types.js";
import { pcoForUser } from "./auth/oauth.js";
import type { PcoApi } from "./pco/api.js";
import { extras, settings } from "./lib/db.js";
import { clockOutRouter } from "./routes/clock.js";
import { clockOutputs, clockSettings } from "./lib/clock.js";
import { boardOutputs, boardSettings, displayState } from "./lib/board.js";
import { boardOutRouter } from "./routes/board.js";
import { onPhonesChange, phones, phoneSession, phoneUnlock, staffCheckIn, staffUndo, teamCheckIns } from "./lib/teamCheckins.js";
import { kioskSession, onPagingChange, page, PagingError, requestPage, status, stored, unlock } from "./lib/paging.js";
import { companionTuning, relayPress } from "./lib/tuningRelay.js";
import { companionAct, companionFor, companionView, pairingOpen, pairWithCode } from "./lib/companion.js";

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
  if (churchName && churchName.name && Date.now() - churchName.at < 3600e3) return churchName.name;
  const o = stored().owner ?? phones().owner;
  const api = o ? pcoForUser(o.userId, o.demo) : null;
  const name = api ? await api.me().then((m) => m.orgName).catch(() => "") : "";
  churchName = { name, at: Date.now() };
  return name;
}

/** Status for one ministry's iPads: the shared on-screen lock, and only their own recent pages. */
function forMinistry(m: Ministry) {
  const s = status();
  return {
    ...s,
    recent: s.recent.filter((e) => e.ministry === m).map(({ by: _by, ...e }) => ({ ...e, by: "" })),
    requests: s.requests.filter((r) => r.ministry === m).map(({ by: _by, ...r }) => ({ ...r, by: "" })),
  };
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
  const info: KioskInfo = { ministry: m, title: cfg.title, church: await church(), logo: settings.get().logo, unlocked: signedIn(req), enabled: cfg.enabled, approval: stored().config.approval };
  res.json(info);
}));

kioskRouter.post("/:ministry/unlock", h(async (req, res) => {
  const m = req.params.ministry as Ministry;
  const { pin } = z.object({ pin: z.string().max(12) }).parse(req.body);
  const r = unlock(m, pin, req.ip ?? "unknown");
  if ("error" in r) {
    const message = r.error === "no_pin" ? "This page isn't set up yet. Ask a staff member to set a PIN in Sundays → Settings."
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
  if (!api) throw new PagingError("not_configured", "Ask a staff member to open Sundays → Settings and save the Kids & Nursery settings.", 503);
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
  if (stored().config.approval) {
    const request = requestPage(m, code, { by: `${title} iPad`, actorId: `ipad:${m}`, childName });
    return res.json({ ok: true, requested: true, request: { ...request, by: "" }, status: forMinistry(m) });
  }
  await page(m, code, { by: `${title} iPad`, actorId: `ipad:${m}`, childName });
  res.json({ ok: true, status: forMinistry(m) });
}));

/* ───────────── FOH companions (on the network) ───────────── */

const companionLanRouter = Router();
companionLanRouter.get("/hello", h(async (_req, res) => res.json({ app: "cool-services", name: (await church()) || "Sundays" })));
companionLanRouter.post("/pair", h(async (req, res) => {
  const { code, name } = z.object({ code: z.string().regex(/^\d{6}$/), name: z.string().max(60) }).parse(req.body);
  const r = pairWithCode(code, name, req.socket.remoteAddress ?? "?");
  if ("error" in r) return res.status(400).json({ error: "pair_failed", message: r.error });
  applyKiosk();
  res.json(r);
}));
const needCompanion = (req: Request, res: Response, next: NextFunction) => {
  const c = companionFor(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
  if (!c) return res.status(401).json({ error: "not_paired" });
  (req as Request & { companion?: string }).companion = c.name;
  next();
};
// With the mics as they are on the mic board (hidden ones left out, a person's mics stacked) for the companion's mic strip.
companionLanRouter.get("/state", needCompanion, h(async (_req, res) => res.json({
  ...companionView(), mics: (await displayState().catch(() => null))?.tiles ?? [], tuning: await companionTuning().catch(() => null),
})));
/** A Tuning key pressed on the companion: sent to Waves from this computer. */
companionLanRouter.post("/tuning", needCompanion, h(async (req, res) => {
  const { slot } = z.object({ slot: z.string().max(60) }).parse(req.body);
  res.json(await relayPress(slot, `FOH (${(req as Request & { companion?: string }).companion})`));
}));
companionLanRouter.post("/act", needCompanion, h(async (req, res) => {
  const { id, action } = z.object({ id: z.string().max(60), action: z.enum(["accept", "hold", "deny"]) }).parse(req.body);
  companionAct(id, action, `FOH (${(req as Request & { companion?: string }).companion})`);
  res.json(companionView());
}));

/* ───────────── Team check-ins on phones (leads view, staff check-in) ───────────── */

const phoneCookie = "cs_team";
const roleZ = z.enum(["leads", "staff"]);
function phonesPco() {
  const o = phones().owner;
  return o ? pcoForUser(o.userId, o.demo) : null;
}
const teamLanRouter = Router();
teamLanRouter.use((_req, res, next) => (phones().enabled ? next() : res.status(404).json({ error: "not_found" })));
teamLanRouter.get("/:role/info", h(async (req, res) => {
  const role = roleZ.parse(req.params.role);
  const info: TeamPhoneInfo = { role, church: await church(), logo: settings.get().logo, unlocked: phoneSession(role, req.cookies?.[phoneCookie]), enabled: true };
  res.json(info);
}));
teamLanRouter.post("/:role/unlock", h(async (req, res) => {
  const role = roleZ.parse(req.params.role);
  const { pin } = z.object({ pin: z.string().max(12) }).parse(req.body);
  const r = phoneUnlock(role, pin, req.ip ?? "unknown");
  if ("error" in r) {
    const message = r.error === "no_pin" ? "This page isn’t set up yet. Ask a staff member to set a PIN in Sundays → Preferences → Network Connections → Team check-ins on phones."
      : r.error === "too_many_tries" ? `Too many tries. Wait ${r.waitSeconds} seconds.` : "That PIN isn’t right.";
    return res.status(r.error === "too_many_tries" ? 429 : 401).json({ ...r, message });
  }
  res.cookie(phoneCookie, r.token, cookieOpts);
  res.json({ ok: true });
}));
teamLanRouter.post("/:role/lock", (_req, res) => { res.clearCookie(phoneCookie, { path: "/" }); res.json({ ok: true }); });
const needPhone = (req: Request, res: Response, next: NextFunction) => {
  const role = roleZ.safeParse(req.params.role);
  if (!role.success || !phoneSession(role.data, req.cookies?.[phoneCookie])) return res.status(401).json({ error: "locked" });
  next();
};
const denied = () => "Planning Center Check-Ins isn’t available to the account that set up these pages, so only staff check-ins show.";
teamLanRouter.get("/:role/data", needPhone, h(async (req, res) => {
  const api = phonesPco();
  if (!api) return res.status(503).json({ error: "not_configured", message: "Ask a staff member to open Sundays → Preferences and save the Team check-ins phone settings." });
  const cutoff = Date.now() - 8 * 3600e3;
  const plans = (await api.listUpcomingPlans()).filter((p) => Date.parse(p.sortDate) > cutoff).slice(0, 14);
  const services = plans.map((p) => ({
    id: p.id, serviceTypeId: p.serviceTypeId, sortDate: p.sortDate,
    label: `${new Date(p.sortDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${p.serviceTypeName}`,
  }));
  // Unless the phone picked one: the picked weekend's first service.
  const inWeekend = new Set((await weekendPlans(api).catch(() => [])).map((p) => p.id));
  const chosen = services.find((x) => x.id === req.query.plan) ?? services.find((x) => inWeekend.has(x.id)) ?? services[0] ?? null;
  const out: TeamPhoneData = {
    services, planId: chosen?.id ?? null, groups: extras.get<TeamGroup[]>("teamGroups", []),
    data: chosen ? await teamCheckIns(api, chosen.serviceTypeId, chosen.id, denied, "phones") : null,
  };
  res.set("Cache-Control", "no-store").json(out);
}));
teamLanRouter.post("/:role/checkin", needPhone, h(async (req, res) => {
  if (req.params.role !== "staff") return res.status(403).json({ error: "forbidden", message: "Only the staff page can check people in." });
  const api = phonesPco();
  if (!api) return res.status(503).json({ error: "not_configured", message: "Not set up yet." });
  const b = z.object({ st: z.string().max(40), plan: z.string().max(40), personId: z.string().regex(/^\w{1,30}$/), undo: z.boolean().optional(), by: z.string().trim().max(40).optional() }).parse(req.body);
  try {
    if (b.undo) { await staffUndo(api, b.st, b.plan, b.personId); return res.json({ ok: true }); }
    const r = await staffCheckIn(api, b.st, b.plan, b.personId, b.by ? `${b.by} (staff phone)` : "Staff phone");
    res.json({ ok: true, ...r });
  } catch (e) {
    if ((e as { status?: number }).status === 404) return res.status(404).json({ error: "not_found", message: (e as Error).message });
    throw e;
  }
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
  // iPad pages only while they're turned on (the listener may be running just for FOH companions).
  const ipadsOn = (_req: Request, res: Response, next: NextFunction) => (stored().config.ipads.enabled ? next() : res.status(404).json({ error: "not_found" }));
  app.use("/api/kiosk", ipadsOn, kioskRouter);
  app.use("/api/companion", companionLanRouter);
  app.use("/api/team", teamLanRouter);
  // The clock's feed is also what the stage display's Clock view uses.
  const clockOn = (_req: Request, res: Response, next: NextFunction) => (clockSettings().lan || boardSettings().lan ? next() : res.status(404).json({ error: "not_found" }));
  const boardOn = (_req: Request, res: Response, next: NextFunction) => (boardSettings().lan ? next() : res.status(404).json({ error: "not_found" }));
  app.use("/api/board-out", boardOn, boardOutRouter); // the stage display on TVs and stage screens
  app.use("/api/clock-out", clockOn, clockOutRouter); // the clock on TVs / iPads / stage displays, and Companion control
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
      // staff.… / leads.… (or the names set in Preferences) go to the Team check-ins phone pages.
      const tn = phones().hostnames;
      const role = (["leads", "staff"] as const).find((x) => tn[x] && tn[x] === host) ?? (["leads", "staff"] as const).find((x) => host.split(".")[0] === x);
      if (role) return res.redirect(302, `/${role}`);
      next();
    });
    app.get(["/", "/nursery", "/kids"], ipadsOn, send);
    // The stage display (mic board / clock).
    app.get("/display", (_req, res, next) => (boardSettings().lan ? next() : res.status(404).send("The stage display isn’t shared on the network. Turn it on in Sundays → Mic board → Display settings.")),
      (_req, res) => res.set("Cache-Control", "no-cache").sendFile(path.join(webRoot!, "displayout.html")));
    // The production clock (full screen in any browser on the network).
    app.get("/clock", (_req, res, next) => (clockSettings().lan ? next() : res.status(404).send("The clock isn’t shared on the network. Turn it on in Sundays → Preferences → Clock.")), (_req, res) => res.set("Cache-Control", "no-cache").sendFile(path.join(webRoot!, "clockout.html")));
    const teamPage = path.join(webRoot, "team.html");
    app.get(["/leads", "/staff"], (_req, res) => (phones().enabled ? res.set("Cache-Control", "no-cache").sendFile(teamPage) : res.status(404).send("Not found")));
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
  // Also listen for FOH companions (paired ones, or while a pairing code is showing).
  const want = enabled || phones().enabled || clockSettings().lan || boardSettings().lan || pairingOpen() || (stored().companions ?? []).length ? { port } : null;
  if (listening && want && listening.port === want.port) return;
  if (server) { server.close(); server.closeAllConnections?.(); server = null; listening = null; }
  lastError = undefined;
  if (!want) return;
  const s = createKioskApp().listen(want.port, "0.0.0.0", () => {
    listening = want;
    console.log(`  Network pages (iPads, team phones, companions) on port ${want.port}`);
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
  onPhonesChange(applyKiosk);
  clockOutputs.onSettings(() => applyKiosk());
  boardOutputs.onSettings(() => applyKiosk());
}
