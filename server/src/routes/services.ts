import { Router } from "express";
import { rememberTeams } from "./teamGroups.js";
import { z } from "zod";
import { audit } from "../lib/db.js";
import { lowPriority } from "../pco/client.js";
import { checkInsDenied } from "../auth/oauth.js";
import { SignedOutError } from "../pco/client.js";
import type { PlanDetail, TeamCheckIns } from "../../../shared/types.js";

export const servicesRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

servicesRouter.get("/service-types", h(async (req, res) => res.json(await req.pco.listServiceTypes())));

servicesRouter.get("/plans", h(async (req, res) =>
  res.json(await req.pco.listUpcomingPlans(req.query.serviceTypeId as string | undefined))));

servicesRouter.get("/matrix/:st", h(async (req, res) => {
  const weeks = Math.min(16, Math.max(1, Number(req.query.weeks) || 6));
  const past = Math.min(8, Math.max(0, Number(req.query.past) || 0));
  res.json(await req.pco.getMatrix(req.params.st, weeks, past));
}));

/* ───────────── Editing the run sheet (writes to Planning Center) ───────────── */

const ItemInputZ = z.object({
  kind: z.enum(["song", "header", "media", "item"]).optional(),
  title: z.string().trim().max(255).optional(),
  lengthSec: z.number().int().min(0).max(24 * 3600).optional(),
  description: z.string().max(5000).nullable().optional(),
  servicePosition: z.enum(["pre", "during", "post"]).optional(),
  songId: z.string().max(40).nullable().optional(),
  arrangementId: z.string().max(40).nullable().optional(),
  keyId: z.string().max(40).nullable().optional(),
  afterItemId: z.string().max(40).nullable().optional(),
});

servicesRouter.get("/types/:st/note-categories", h(async (req, res) => res.json(await req.pco.listNoteCategories(req.params.st))));
servicesRouter.get("/songs", h(async (req, res) => res.json(await req.pco.searchSongs(String(req.query.q ?? "").slice(0, 100)))));
servicesRouter.get("/songs/:id/arrangements", h(async (req, res) => res.json(await req.pco.songArrangements(req.params.id))));

servicesRouter.post("/plans/:st/:plan/items", h(async (req, res) => {
  const input = ItemInputZ.parse(req.body);
  const items = await req.pco.createItem(req.params.st, req.params.plan, input);
  await audit(req.user.id, "plan.item.add", "Plan", req.params.plan, { kind: input.kind, title: input.title });
  res.json(items);
}));
servicesRouter.patch("/plans/:st/:plan/items/:item", h(async (req, res) => {
  const items = await req.pco.updateItem(req.params.st, req.params.plan, req.params.item, ItemInputZ.parse(req.body));
  await audit(req.user.id, "plan.item.edit", "Item", req.params.item, req.body);
  res.json(items);
}));
servicesRouter.delete("/plans/:st/:plan/items/:item", h(async (req, res) => {
  const items = await req.pco.deleteItem(req.params.st, req.params.plan, req.params.item);
  await audit(req.user.id, "plan.item.delete", "Item", req.params.item);
  res.json(items);
}));
servicesRouter.post("/plans/:st/:plan/items-order", h(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string().max(40)).max(300) }).parse(req.body);
  res.json(await req.pco.reorderItems(req.params.st, req.params.plan, ids));
}));
servicesRouter.put("/plans/:st/:plan/items/:item/notes", h(async (req, res) => {
  const note = z.object({ noteId: z.string().max(40).optional(), categoryId: z.string().max(40), content: z.string().max(5000) }).parse(req.body);
  res.json(await req.pco.saveItemNote(req.params.st, req.params.plan, req.params.item, note));
}));
servicesRouter.delete("/plans/:st/:plan/items/:item/notes/:note", h(async (req, res) =>
  res.json(await req.pco.deleteItemNote(req.params.st, req.params.plan, req.params.item, req.params.note))));

servicesRouter.get("/plans/:st/:plan/item-times", h(async (req, res) => res.json(await req.pco.getItemTimes(req.params.st, req.params.plan))));

servicesRouter.post("/plans/:st/:plan/live/:action", h(async (req, res) => {
  const action = z.enum(["next", "previous", "take_control"]).parse(req.params.action);
  res.json({ live: await req.pco.liveControl(req.params.st, req.params.plan, action) });
}));

servicesRouter.get("/plans/:st/:plan/runsheet", h(async (req, res) => res.json(await req.pco.getRunSheet(req.params.st, req.params.plan))));

servicesRouter.get("/plans/:st/:plan/live", h(async (req, res) => {
  try {
    res.json({ live: await req.pco.getLive(req.params.st, req.params.plan) });
  } catch (e: any) {
    if (e?.status === 404 || e?.status === 403) return res.json({ live: null }); // Live not available for this plan
    throw e;
  }
}));

servicesRouter.get("/plans/:st/:plan", h(async (req, res) => res.json(await req.pco.getPlan(req.params.st, req.params.plan))));

/**
 * Team check-ins: everyone scheduled (not declined) on each team, and whether they've checked in
 * with Planning Center Check-Ins during this service's check-in window (matched by person).
 */
servicesRouter.get("/plans/:st/:plan/team-checkins", h(async (req, res) => {
  const plan: PlanDetail = await req.pco.getPlan(req.params.st, req.params.plan);
  let rows: { personId: string | null; at: string }[] = [];
  let checkInsError: string | null = null;
  try {
    rows = (await req.pco.getCheckIns(req.params.st, req.params.plan)).rows;
  } catch (e: any) {
    if (e instanceof SignedOutError) throw e;
    checkInsError = e?.status === 403 || e?.status === 401 ? checkInsDenied(req, e).message : (e?.message ?? "Check-Ins couldn’t be read.");
  }
  const firstIn = new Map<string, string>();
  for (const r of rows) if (r.personId && (!firstIn.has(r.personId) || r.at < firstIn.get(r.personId)!)) firstIn.set(r.personId, r.at);
  const teams = new Map<string, TeamCheckIns["teams"][number]>();
  for (const m of plan.roster) {
    if (m.status === "D") continue;
    const t: TeamCheckIns["teams"][number] = teams.get(m.teamId) ?? { teamId: m.teamId, teamName: m.teamName, people: [] };
    const p = t.people.find((x) => x.personId === m.personId);
    if (p) p.positions.push(m.positionName);
    else t.people.push({ personId: m.personId, name: m.name, avatarUrl: m.avatarUrl, positions: [m.positionName], status: m.status, checkedInAt: firstIn.get(m.personId) ?? null });
    teams.set(m.teamId, t);
  }
  rememberTeams(plan.teams.map((t) => ({ id: t.id, name: t.name })));
  const order = plan.teams.map((t) => t.id);
  const out: TeamCheckIns = {
    teams: [...teams.values()].sort((a, b) => (order.indexOf(a.teamId) + 1 || 999) - (order.indexOf(b.teamId) + 1 || 999)),
    checkInsError, fetchedAt: new Date().toISOString(),
  };
  res.json(out);
}));

servicesRouter.get("/plans/:st/:plan/checkins", h(async (req, res) => {
  try {
    res.json(await req.pco.getCheckIns(req.params.st, req.params.plan));
  } catch (e: any) {
    if (e?.status === 403 || e?.status === 401) return res.status(403).json(checkInsDenied(req, e));
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
