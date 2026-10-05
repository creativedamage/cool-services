/** /api/weekend (signed in): the weekend Sundays works on everywhere, and the weekends to pick from. */
import { Router } from "express";
import { z } from "zod";
import { setWeekend, weekendView } from "../lib/weekend.js";

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

export const weekendRouter = Router();
weekendRouter.get("/", h(async (req, res) => res.set("Cache-Control", "no-store").json(await weekendView(req.pco ?? null))));
weekendRouter.put("/", h(async (req, res) => {
  const { sunday } = z.object({ sunday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).parse(req.body);
  setWeekend(sunday);
  res.json(await weekendView(req.pco ?? null));
}));
