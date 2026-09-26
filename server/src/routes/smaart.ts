/** /api/smaart: Smaart v9 SPL connection (Settings) and live readings (dashboard). */
import { Router } from "express";
import { z } from "zod";
import { extras } from "../lib/db.js";
import { applySmaart, smaartStatus, type SmaartConfig } from "../lib/smaart.js";

export const smaartDefaults: SmaartConfig = { enabled: false, host: "", port: 26000, password: "", path: "/api/v3/", limit: 95 };
export const smaartConfig = () => ({ ...smaartDefaults, ...extras.get<Partial<SmaartConfig>>("smaart", {}) });
export const startSmaart = () => applySmaart(smaartConfig());

export const smaartRouter = Router();
smaartRouter.get("/config", (_req, res) => { const c = smaartConfig(); res.json({ ...c, password: "", hasPassword: Boolean(c.password) }); });
smaartRouter.put("/config", (req, res) => {
  const p = z.object({
    enabled: z.boolean(), host: z.string().trim().max(255).regex(/^[A-Za-z0-9.\-:]*$/), port: z.number().int().min(1).max(65535),
    password: z.string().max(200).optional(), path: z.string().max(60).regex(/^\/?[\w\-/.]*$/), limit: z.number().min(40).max(140),
  }).partial().parse(req.body);
  const cur = smaartConfig();
  const next: SmaartConfig = { ...cur, ...p, password: p.password === undefined ? cur.password : p.password };
  extras.set("smaart", next);
  applySmaart(next);
  res.json({ ...next, password: "", hasPassword: Boolean(next.password) });
});
smaartRouter.get("/status", (_req, res) => res.json(smaartStatus()));
