/**
 * /api/volunteer-checkin: Preferences → Team Check-ins. Which Planning Center Check-Ins event
 * volunteers check in to for each service type, and each team's location (area of serving) in it.
 * Staff check-ins are recorded as volunteers there; Check-Ins scans to other events don't count.
 */
import { Router } from "express";
import { z } from "zod";
import type { CheckInLocation, VolunteerCheckInSetup } from "../../../shared/types.js";
import { saveVolunteerConfig, volunteerConfig } from "../lib/teamCheckins.js";

export const volunteerCheckInRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

volunteerCheckInRouter.get("/", h(async (req, res) => {
  const types = await req.pco.listServiceTypes();
  const serviceTypes = await Promise.all(types.map(async (t: { id: string; name: string }) => ({ id: t.id, name: t.name, teams: await req.pco.listTeams(t.id).catch(() => []) })));
  let eventsError: string | null = null;
  const locs: CheckInLocation[] = await req.pco.listCheckInLocations().catch((e: any) => { eventsError = e?.status === 401 || e?.status === 403 ? "Your Planning Center account can’t read Check-Ins." : (e?.message ?? "Check-Ins couldn’t be read."); return []; });
  const events = new Map<string, VolunteerCheckInSetup["events"][number]>();
  for (const l of locs) {
    const id = l.eventId ?? l.event;
    const e = events.get(id) ?? { id, name: l.event, locations: [] };
    e.locations.push({ id: l.id, name: l.name, folder: l.folder });
    events.set(id, e);
  }
  // Volunteer-looking events first.
  const vol = (n: string) => (/volunteer|serve|team/i.test(n) ? 0 : 1);
  const out: VolunteerCheckInSetup = {
    config: volunteerConfig(), serviceTypes,
    events: [...events.values()].sort((a, b) => vol(a.name) - vol(b.name) || a.name.localeCompare(b.name)),
    eventsError,
  };
  res.json(out);
}));

const Ref = z.object({ id: z.string().max(60), name: z.string().max(120) });
volunteerCheckInRouter.put("/", (req, res) => {
  const c = z.object({ events: z.record(z.string().max(40), Ref), teamLocations: z.record(z.string().max(40), Ref) }).parse(req.body);
  res.json(saveVolunteerConfig(c));
});
