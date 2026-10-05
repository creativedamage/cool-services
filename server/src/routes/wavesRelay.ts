/**
 * /api/waves (signed in, this Mac's Sundays window): Tuning keys pressed on an FOH companion,
 * sent to Waves from here (see lib/tuningRelay.ts).
 */
import { Router } from "express";
import { z } from "zod";
import { nextPress, notePressed, pressResult, requeue } from "../lib/tuningRelay.js";

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

export const wavesRelayRouter = Router();
wavesRelayRouter.get("/next", h(async (req, res) => {
  let gone = false;
  req.on("close", () => { gone = true; });
  const p = await nextPress(20_000);
  if (gone && p) { requeue(p); return; } // that window went away (reloaded, closed): another one takes it
  res.set("Cache-Control", "no-store").json({ press: p });
}));
wavesRelayRouter.post("/result", (req, res) => {
  const b = z.object({ id: z.string().max(60), ok: z.boolean(), snapshot: z.number().optional(), error: z.string().max(400).optional() }).parse(req.body);
  pressResult(b.id, b);
  res.json({ ok: true });
});
wavesRelayRouter.post("/pressed", (req, res) => {
  const b = z.object({ slot: z.string().max(60), label: z.string().max(120) }).parse(req.body);
  notePressed(b.slot, b.label);
  res.json({ ok: true });
});
