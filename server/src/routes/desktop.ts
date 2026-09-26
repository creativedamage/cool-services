/**
 * /api/desktop: things only the Mac app can do, registered by desktop/src/main.ts.
 * Right now: showing Planning Center Chat inside the window.
 */
import { Router } from "express";
import { z } from "zod";
import type { EmbedBridge } from "../../../shared/embed.js";

let embed: EmbedBridge | null = null;
export const setEmbedBridge = (b: EmbedBridge) => { embed = b; };

export const desktopRouter = Router();

const Req = z.object({
  action: z.enum(["show", "hide", "reload", "home"]),
  // Only Planning Center's own pages can be shown in the window.
  url: z.string().url().refine((u) => { try { const h = new URL(u); return h.protocol === "https:" && (h.hostname === "planningcenteronline.com" || h.hostname.endsWith(".planningcenteronline.com")); } catch { return false; } }).optional(),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number().min(0), height: z.number().min(0) }).optional(),
});

desktopRouter.get("/embed", (_req, res) => res.json({ available: Boolean(embed) }));
desktopRouter.post("/embed", (req, res) => {
  if (!embed) return res.status(404).json({ error: "unavailable", message: "Only in the Cool Services Mac app." });
  res.json(embed.apply(Req.parse(req.body)));
});
