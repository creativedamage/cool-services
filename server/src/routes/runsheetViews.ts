/** /api/runsheet-views: operator views for the full run sheet (saved on this Mac). */
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { runSheetViews } from "../lib/db.js";

export const runSheetViewsRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const View = z.object({
  name: z.string().trim().min(1).max(60),
  categories: z.array(z.string().max(80)).max(60),
  highlight: z.string().max(80).nullable(),
  planNotes: z.array(z.string().max(80)).max(60).nullable(),
  showDescriptions: z.boolean(),
});

runSheetViewsRouter.get("/", h(async (_req, res) => res.json(runSheetViews.list())));
runSheetViewsRouter.post("/", h(async (req, res) => res.status(201).json(runSheetViews.save({ id: crypto.randomUUID(), ...View.parse(req.body) }))));
runSheetViewsRouter.put("/:id", h(async (req, res) => res.json(runSheetViews.save({ id: req.params.id, ...View.parse(req.body) }))));
runSheetViewsRouter.delete("/:id", h(async (req, res) => { runSheetViews.remove(req.params.id); res.status(204).end(); }));
