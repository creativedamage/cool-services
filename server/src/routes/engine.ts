/**
 * /api/engine: the other Sundays apps on this Mac using this server (see lib/engine.ts). Everything
 * here needs the engine key except /enter, which takes a one-time ticket made with it.
 */
import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { APP_IDS, type AppId } from "../../../shared/apps.js";
import { handoffSession } from "../auth/oauth.js";
import { callResult, engineAuthorized, engineHost, guestGone, nextCalls } from "../lib/engine.js";

export const engineRouter = Router();
const AppQ = z.enum(APP_IDS as [AppId, ...AppId[]]);

const keyed = (req: Request, res: Response, next: NextFunction) =>
  engineAuthorized(req.get("x-sundays-engine")) ? next() : res.status(403).json({ error: "forbidden" });

engineRouter.get("/hello", keyed, (_req, res) => res.json({ ok: true, host: engineHost(), version: process.env.APP_VERSION ?? "dev" }));

/** One-time tickets: a guest's window opens /enter with one and starts signed in. */
const tickets = new Map<string, number>();
engineRouter.post("/ticket", keyed, (_req, res) => {
  const now = Date.now();
  for (const [t, until] of tickets) if (until < now) tickets.delete(t);
  const t = crypto.randomBytes(24).toString("base64url");
  tickets.set(t, now + 60_000);
  res.json({ ticket: t });
});
const safeNext = (v: unknown) => (typeof v === "string" && /^\/(?!\/)[\w\-/?=&.%#]*$/.test(v) ? v : "/start");
engineRouter.get("/enter", async (req, res, next) => {
  try {
    const t = String(req.query.t ?? "");
    const until = tickets.get(t);
    tickets.delete(t);
    const page = safeNext(req.query.next);
    if (!until || until < Date.now()) return res.redirect("/");
    // Nobody signed in yet: the sign-in page, which comes back to this page.
    if (!(await handoffSession(res))) return res.redirect(page === "/start" ? "/" : `/?return=${encodeURIComponent(page)}`);
    res.redirect(page);
  } catch (e) { next(e); }
});

engineRouter.get("/calls", keyed, async (req, res, next) => {
  try {
    const app = AppQ.parse(req.query.app);
    res.json({ calls: await nextCalls(app, typeof req.query.v === "string" ? req.query.v.slice(0, 20) : null) });
  } catch (e) { next(e); }
});
engineRouter.post("/results", keyed, (req, res) => {
  const app = AppQ.parse(req.query.app);
  const r = z.object({ id: z.string().max(64), ok: z.boolean(), value: z.unknown().optional(), error: z.string().max(500).optional() }).parse(req.body);
  callResult(app, r);
  res.json({ ok: true });
});
engineRouter.post("/bye", keyed, (req, res) => { guestGone(AppQ.parse(req.query.app)); res.json({ ok: true }); });
