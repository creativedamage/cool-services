/** /api/dashboard: which widgets are on the dashboard, and their options (saved on this Mac). */
import { Router } from "express";
import { z } from "zod";
import { extras } from "../lib/db.js";

export const dashboardRouter = Router();
const Widget = z.object({
  id: z.string().max(40),
  type: z.enum(["tuning", "spl", "wireless", "live", "clock", "pro", "prodclock"]),
  size: z.enum(["s", "m", "l"]),
  options: z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).default({}),
});
// NDI previews were removed in 1.13: drop those widgets from saved layouts.
dashboardRouter.get("/", (_req, res) => {
  const w = extras.get<{ type: string }[] | null>("dashboard", null);
  res.json(w ? w.filter((x) => x.type !== "ndi") : null);
});

/** Your service: which service type (campus) the dashboard follows, optionally pinned to one plan. */
dashboardRouter.get("/home", (_req, res) => res.json(extras.get("home", { serviceTypeId: null, planId: null })));
dashboardRouter.put("/home", (req, res) => {
  const id = z.string().regex(/^[\w-]{1,40}$/).nullable();
  const home = z.object({ serviceTypeId: id, planId: id }).parse(req.body);
  extras.set("home", home);
  res.json(home);
});
dashboardRouter.put("/", (req, res) => {
  const widgets = z.array(Widget).max(24).parse(req.body);
  extras.set("dashboard", widgets);
  res.json(widgets);
});
