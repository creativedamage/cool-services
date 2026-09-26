import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { StagePlot } from "../../../shared/types.js";
import { files, plots } from "../lib/db.js";

export const stageRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const Link = z.union([
  z.object({ kind: z.literal("mic"), channelId: z.string() }),
  z.object({ kind: z.literal("position"), position: z.string().max(80) }),
  z.null(),
]);
const Item = z.object({
  id: z.string().max(40),
  type: z.enum(["vocal", "mic", "di", "wedge", "iem", "amp", "keys", "drums", "acoustic", "electric", "bass", "person", "power", "riser", "label"]),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  w: z.number().min(0.01).max(1).optional(), h: z.number().min(0.01).max(1).optional(),
  rotation: z.number().min(-360).max(360),
  label: z.string().max(60),
  link: Link,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  radius: z.number().min(0).max(40).optional(),
});
const Plot = z.object({
  name: z.string().min(1).max(80),
  serviceTypeId: z.string().nullable(),
  background: z.object({ fileId: z.string(), width: z.number(), height: z.number(), source: z.string().max(200) }).nullable(),
  items: z.array(Item).max(400),
});

stageRouter.get("/plots", h(async (_req, res) => res.json(plots.list())));
stageRouter.post("/plots", h(async (req, res) => {
  const body = Plot.partial().parse(req.body ?? {});
  const plot: StagePlot = {
    id: crypto.randomUUID(), name: body.name ?? "New stage plot", serviceTypeId: body.serviceTypeId ?? null,
    background: body.background ?? null, items: body.items ?? [], updatedAt: "",
  };
  res.status(201).json(plots.save(plot));
}));
stageRouter.get("/plots/:id", h(async (req, res) => {
  const p = plots.get(req.params.id);
  return p ? res.json(p) : res.status(404).json({ error: "not_found" });
}));
stageRouter.put("/plots/:id", h(async (req, res) => {
  if (!plots.get(req.params.id)) return res.status(404).json({ error: "not_found" });
  res.json(plots.save({ id: req.params.id, ...Plot.parse(req.body), updatedAt: "" }));
}));
stageRouter.delete("/plots/:id", h(async (req, res) => { plots.remove(req.params.id); res.status(204).end(); }));

/** Which plot a service uses: its own choice, else its service type's default, else none. */
stageRouter.get("/plans/:plan", h(async (req, res) => {
  res.json({ plotId: plots.forPlan(req.params.plan) });
}));
stageRouter.put("/plans/:plan", h(async (req, res) => {
  const { plotId } = z.object({ plotId: z.string().nullable() }).parse(req.body);
  plots.setForPlan(req.params.plan, plotId);
  res.json({ plotId });
}));

/** Background images (a PDF page arrives already turned into a PNG by the app). */
stageRouter.post("/files", h(async (req, res) => {
  const { dataUrl } = z.object({ dataUrl: z.string().max(24_000_000) }).parse(req.body);
  const m = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: "invalid_request", message: "Use a PDF, PNG, JPG or WebP file" });
  const id = files.save(Buffer.from(m[2], "base64"), m[1] === "jpeg" ? "jpg" : (m[1] as "png" | "webp"));
  res.status(201).json({ fileId: id });
}));
stageRouter.get("/files/:id", h(async (req, res) => {
  const p = files.path(req.params.id);
  if (!p) return res.status(404).end();
  res.set("Cache-Control", "private, max-age=31536000, immutable").sendFile(p);
}));
