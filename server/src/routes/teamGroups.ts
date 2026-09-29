/** /api/team-groups: ministries that group teams on the Team check-ins page (kept on this Mac). */
import { Router } from "express";
import { z } from "zod";
import type { TeamGroup } from "../../../shared/types.js";
import { extras } from "../lib/db.js";

export const teamGroupsRouter = Router();

/** Every team seen on a service here, so ministries can be set up for teams not on today's service. */
export function rememberTeams(list: { id: string; name: string }[]) {
  const known = new Map(extras.get<{ id: string; name: string }[]>("knownTeams", []).map((t) => [t.id, t.name]));
  let changed = false;
  for (const t of list) if (known.get(t.id) !== t.name) { known.set(t.id, t.name); changed = true; }
  if (changed) extras.set("knownTeams", [...known].map(([id, name]) => ({ id, name })).slice(-300));
}
teamGroupsRouter.get("/teams", (_req, res) => res.json(extras.get<{ id: string; name: string }[]>("knownTeams", [])));
teamGroupsRouter.get("/", (_req, res) => res.json(extras.get<TeamGroup[]>("teamGroups", [])));
teamGroupsRouter.put("/", (req, res) => {
  const groups = z.array(z.object({ id: z.string().regex(/^[\w-]{1,40}$/), name: z.string().trim().min(1).max(60), teamIds: z.array(z.string().max(40)).max(300) })).max(60).parse(req.body);
  const seen = new Set<string>(); // a team sits in one ministry
  const clean = groups.map((g) => ({ ...g, teamIds: g.teamIds.filter((t) => !seen.has(t) && seen.add(t)) }));
  extras.set("teamGroups", clean);
  res.json(clean);
});
