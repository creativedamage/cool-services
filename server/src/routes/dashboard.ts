/** /api/dashboard: which widgets are on the dashboard, and their options (saved on this Mac). */
import { Router } from "express";
import { z } from "zod";
import { extras } from "../lib/db.js";

export const dashboardRouter = Router();
const Widget = z.object({
  id: z.string().max(40),
  type: z.enum(["tuning", "ndi", "spl", "wireless", "live", "clock", "pro"]),
  size: z.enum(["s", "m", "l"]),
  options: z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).default({}),
});
dashboardRouter.get("/", (_req, res) => res.json(extras.get("dashboard", null)));
dashboardRouter.put("/", (req, res) => {
  const widgets = z.array(Widget).max(24).parse(req.body);
  extras.set("dashboard", widgets);
  res.json(widgets);
});
