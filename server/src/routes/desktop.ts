/**
 * /api/desktop: things only the Mac app can do, registered by desktop/src/main.ts.
 * Right now: showing Planning Center Chat inside the window.
 */
import { Router } from "express";
import { z } from "zod";
import type { EmbedBridge } from "../../../shared/embed.js";
import type { NdiViewerBridge } from "../../../shared/ndiView.js";

let embed: EmbedBridge | null = null;
export const setEmbedBridge = (b: EmbedBridge) => { embed = b; };

let ndi: NdiViewerBridge | null = null;
export const setNdiViewer = (b: NdiViewerBridge) => { ndi = b; };

let prefs: ((section: string) => void) | null = null;
/** The Mac app opens Preferences in their own window. */
export const setPrefsOpener = (fn: (section: string) => void) => { prefs = fn; };

export const desktopRouter = Router();

desktopRouter.post("/preferences", (req, res) => {
  if (!prefs) return res.status(404).json({ error: "unavailable" });
  const { section } = z.object({ section: z.string().regex(/^[a-z-]{1,30}$/).default("about") }).parse(req.body ?? {});
  prefs(section);
  res.json({ ok: true });
});

/* ── NDI previews (ProPresenter outputs on the dashboard) ── */
desktopRouter.get("/ndi/sources", async (_req, res) => {
  if (!ndi) return res.json({ available: false, error: "NDI previews work in the Cool Services Mac app.", sources: [] });
  const a = ndi.available();
  if (!a.ok) return res.json({ available: false, error: a.error, sources: [] });
  try { res.json({ available: true, sources: await ndi.sources() }); } catch (e) { res.json({ available: false, error: (e as Error).message, sources: [] }); }
});
/** Newest frame of a source as a JPEG (the dashboard asks again as soon as each one arrives). */
desktopRouter.get("/ndi/frame", (req, res) => {
  const name = String(req.query.source ?? "");
  const f = ndi && name ? ndi.frame(name) : null;
  if (!f) return res.status(204).end(); // still connecting
  res.set({ "Cache-Control": "no-store", "X-Frame-Size": f.size, "X-Frame-At": String(f.at) }).type("image/jpeg").send(f.jpeg);
});

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
