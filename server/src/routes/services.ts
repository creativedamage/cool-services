import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/db.js";
import { lowPriority } from "../pco/client.js";

export const servicesRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

servicesRouter.get("/service-types", h(async (req, res) => res.json(await req.pco.listServiceTypes())));

servicesRouter.get("/plans", h(async (req, res) =>
  res.json(await req.pco.listUpcomingPlans(req.query.serviceTypeId as string | undefined))));

servicesRouter.get("/plans/:st/:plan", h(async (req, res) => res.json(await req.pco.getPlan(req.params.st, req.params.plan))));

servicesRouter.get("/plans/:st/:plan/checkins", h(async (req, res) => {
  try {
    res.json(await req.pco.getCheckIns(req.params.st, req.params.plan));
  } catch (e: any) {
    // Signed in before Check-Ins access was added: ask to sign in again (once).
    if (e?.status === 403 || e?.status === 401) return res.status(403).json({ error: "checkins_access", message: "Sign in again to allow Check-Ins." });
    throw e;
  }
}));

servicesRouter.get("/plans/:st/:plan/counts", h(async (req, res) =>
  res.json(await lowPriority.run(true, () => req.pco.getPlanCounts(req.params.st, req.params.plan)))));

servicesRouter.get("/plans/:st/:plan/candidates", h(async (req, res) => {
  const q = z.object({ teamId: z.string(), position: z.string() }).parse(req.query);
  res.json(await req.pco.getCandidates(req.params.st, req.params.plan, q.teamId, q.position));
}));

servicesRouter.get("/plans/:st/:plan/conflicts", h(async (req, res) => {
  const q = z.object({ personId: z.string() }).parse(req.query);
  res.json(await req.pco.getConflicts(req.params.st, req.params.plan, q.personId));
}));

const Schedule = z.object({
  personId: z.string(), teamId: z.string(), positionName: z.string().min(1), notify: z.boolean().default(true),
});
servicesRouter.post("/plans/:st/:plan/team-members", h(async (req, res) => {
  const body = Schedule.parse(req.body);
  const tm = await req.pco.schedule(req.params.st, req.params.plan, body);
  await audit(req.user.id, "plan.schedule", "PlanPerson", tm.id, { ...body, planId: req.params.plan });
  res.status(201).json(tm);
}));

const Status = z.object({ status: z.enum(["C", "U", "D"]), reason: z.string().max(500).optional() });
servicesRouter.patch("/plans/:st/:plan/team-members/:tm", h(async (req, res) => {
  const { status, reason } = Status.parse(req.body);
  const tm = await req.pco.setStatus(req.params.st, req.params.plan, req.params.tm, status, reason);
  await audit(req.user.id, "plan.status", "PlanPerson", tm.id, { status });
  res.json(tm);
}));

servicesRouter.delete("/plans/:st/:plan/team-members/:tm", h(async (req, res) => {
  await req.pco.removeMember(req.params.st, req.params.plan, req.params.tm);
  await audit(req.user.id, "plan.remove", "PlanPerson", req.params.tm);
  res.status(204).end();
}));
