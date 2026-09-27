/**
 * /api/campuses: group service types into campuses, and each person's default campus.
 * Campuses live on this Mac (the data file); the default is per signed-in person.
 */
import { Router } from "express";
import { z } from "zod";
import type { Campus, CampusSettings } from "../../../shared/types.js";
import { extras } from "../lib/db.js";

export const campusesRouter = Router();
const list = () => extras.get<Campus[]>("campuses", []);
const defaultKey = (userId: string) => `campusDefault:${userId}`;
const view = (userId: string): CampusSettings => {
  const campuses = list();
  const d = extras.get<string | null>(defaultKey(userId), null);
  return { campuses, myDefault: campuses.some((c) => c.id === d) ? d : null };
};

campusesRouter.get("/", (req: any, res) => res.json(view(req.user.id)));

campusesRouter.put("/", (req: any, res) => {
  const campuses = z.array(z.object({
    id: z.string().regex(/^[\w-]{1,40}$/), name: z.string().trim().min(1).max(60),
    serviceTypeIds: z.array(z.string().max(40)).max(200),
  })).max(50).parse(req.body);
  // A service type belongs to one campus: the first one that lists it keeps it.
  const seen = new Set<string>();
  const clean = campuses.map((c) => ({ ...c, serviceTypeIds: c.serviceTypeIds.filter((id) => !seen.has(id) && seen.add(id)) }));
  extras.set("campuses", clean);
  res.json(view(req.user.id));
});

campusesRouter.put("/default", (req: any, res) => {
  const { campusId } = z.object({ campusId: z.string().max(40).nullable() }).parse(req.body);
  extras.set(defaultKey(req.user.id), campusId);
  res.json(view(req.user.id));
});
