import { Router } from "express";
import { z } from "zod";
import type { PlanMics } from "../../../shared/types.js";
import { cache, mics } from "../lib/db.js";
import { probe } from "../lib/shure.js";
import { micStatuses } from "../lib/board.js";

export const micsRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const Model = z.enum(["ULXD", "QLXD", "SLXD", "AD", "UHFR"]);
const Setup = z.object({
  receivers: z.array(z.object({
    id: z.string(), name: z.string().max(40), model: Model,
    ip: z.string().trim().regex(/^$|^(\d{1,3}\.){3}\d{1,3}$|^[A-Za-z0-9.-]+$/, "Enter an IP address like 192.168.1.50"),
    channels: z.number().int().min(1).max(4),
  })),
  channels: z.array(z.object({
    id: z.string(), label: z.string().min(1).max(40), kind: z.enum(["vocal", "pack", "other"]),
    receiverId: z.string().nullable(), channel: z.number().int().min(1).max(4),
    positions: z.array(z.string().max(60)).max(20),
    consoleInputs: z.array(z.number().int().min(1).max(128)).max(2).optional(),
  })),
  serviceTypes: z.record(z.object({
    positions: z.record(z.array(z.string().max(60)).max(20)).optional(),
    hideAssigned: z.boolean().optional(),
  })).optional(),
});

micsRouter.get("/setup", h(async (_req, res) => res.json(mics.setup())));
micsRouter.put("/setup", h(async (req, res) => {
  const setup = Setup.parse(req.body);
  mics.saveSetup(setup);
  res.json(setup);
}));

micsRouter.post("/test", h(async (req, res) => {
  const { ip } = z.object({ ip: z.string().min(1) }).parse(req.body);
  res.json(await probe(ip));
}));

micsRouter.get("/plans/:plan", h(async (req, res) => {
  const out: PlanMics = { planId: req.params.plan, ...mics.plan(req.params.plan) };
  res.json(out);
}));

const Assign = z.object({
  assignments: z.array(z.object({ channelId: z.string(), personId: z.string(), name: z.string().max(120) })).max(64),
});
micsRouter.put("/plans/:plan", h(async (req, res) => {
  const { assignments } = Assign.parse(req.body);
  mics.savePlan(req.params.plan, assignments);
  res.json({ planId: req.params.plan, ...mics.plan(req.params.plan) });
}));

/**
 * Live status of every receiver that has an IP address (read-only; see lib/shure.ts).
 * Shared for 2 seconds so several open windows don't each poll the receivers.
 */
micsRouter.get("/status", h(async (_req, res) => {
  res.json(await micStatuses());
}));
