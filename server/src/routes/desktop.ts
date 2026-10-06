/**
 * /api/desktop: things only the Mac apps can do. Each window asks its own app (lib/engine.ts):
 * Planning Center Chat inside the window, Preferences in their own window, and which Sundays apps
 * are on this Mac (the apps open each other themselves: sundays-open:// links).
 */
import { Router } from "express";
import { z } from "zod";
import { appFromUserAgent } from "../../../shared/apps.js";
import { appCall, appCan, appListing } from "../lib/engine.js";

export const desktopRouter = Router();
const appOf = (req: { get(h: string): string | undefined }) => appFromUserAgent(req.get("user-agent"));
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

desktopRouter.post("/preferences", h(async (req, res) => {
  const { section } = z.object({ section: z.string().regex(/^[a-z-]{1,30}$/).default("about") }).parse(req.body ?? {});
  const r = await appCall(appOf(req), "prefs.open", section);
  if (!r) return res.status(404).json({ error: "unavailable" });
  res.json({ ok: true });
}));

const Req = z.object({
  action: z.enum(["show", "hide", "reload", "home"]),
  // Only Planning Center's own pages can be shown in the window.
  url: z.string().url().refine((u) => { try { const h = new URL(u); return h.protocol === "https:" && (h.hostname === "planningcenteronline.com" || h.hostname.endsWith(".planningcenteronline.com")); } catch { return false; } }).optional(),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number().min(0), height: z.number().min(0) }).optional(),
});

desktopRouter.get("/embed", (req, res) => res.json({ available: appCan(appOf(req), "embed") }));
desktopRouter.post("/embed", h(async (req, res) => {
  const r = await appCall(appOf(req), "embed.apply", Req.parse(req.body));
  if (!r) return res.status(404).json({ error: "unavailable", message: "Only in the Sundays Mac app." });
  res.json(r);
}));

/** The Sundays apps: which are on this Mac, and which is asking. */
desktopRouter.get("/apps", (req, res) => res.json({ current: appOf(req), apps: appListing(appOf(req)) }));
