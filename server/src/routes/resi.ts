/** /api/resi (signed in): Resi live status, and its settings (Preferences → Video → Resi). */
import { Router } from "express";
import { z } from "zod";
import { pollResi, resiEncoders, resiSettings, resiStatus, saveResiSettings } from "../lib/resi.js";

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

export const resiRouter = Router();
resiRouter.get("/", (_req, res) => res.set("Cache-Control", "no-store").json(resiStatus()));
resiRouter.get("/settings", (_req, res) => res.json(resiSettings()));
resiRouter.put("/settings", h(async (req, res) => {
  const p = z.object({
    enabled: z.boolean(), clientId: z.string().max(200), clientSecret: z.string().max(400), encoderIds: z.array(z.string().max(80)).max(50),
  }).partial().parse(req.body);
  saveResiSettings(p);
  res.json({ settings: resiSettings(), status: await pollResi() });
}));
/** Check the connection now, and list the account's encoders. */
resiRouter.post("/test", h(async (_req, res) => {
  const status = await pollResi();
  const encoders = status.connected ? await resiEncoders().catch(() => []) : [];
  res.json({ status, encoders });
}));
