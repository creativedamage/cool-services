/** /api/team-phones: settings for the Team check-ins phone pages (leads and staff). */
import { Router } from "express";
import { z } from "zod";
import type { TeamPhonesView } from "../../../shared/types.js";
import { phonesConfig, ROLES, savePhonesConfig, setPhonePin, signOutPhones } from "../lib/teamCheckins.js";
import { kioskAddresses } from "./paging.js";

export const teamPhonesRouter = Router();
const role = z.enum(["leads", "staff"]);
const host = (r: string) => z.string().trim().toLowerCase().max(200).regex(/^([a-z0-9-]+(\.[a-z0-9-]+)+)?$/, `Enter a name like ${r}.yourchurch.org`);

export function phonesView(): TeamPhonesView {
  const c = phonesConfig();
  const a = kioskAddresses();
  const withPort = (h: string) => `http://${h}${a.port === 80 ? "" : `:${a.port}`}`;
  const friendly = Object.fromEntries(ROLES.filter((r) => c.hostnames[r]).map((r) => [r, withPort(c.hostnames[r]!)]));
  return { ...c, urls: a.urls, friendly, port: a.port, running: a.running, error: a.error };
}

teamPhonesRouter.get("/", (_req, res) => res.json(phonesView()));
/** Saving makes you the "owner": the phone pages read Services and Check-Ins with your Planning Center access. */
teamPhonesRouter.put("/", (req: any, res) => {
  const p = z.object({ enabled: z.boolean().optional(), hostnames: z.object({ leads: host("leads"), staff: host("staff") }).partial().optional() }).parse(req.body);
  savePhonesConfig(p, { userId: req.user.id, demo: Boolean(req.demo) });
  res.json(phonesView());
});
teamPhonesRouter.put("/pin/:role", (req: any, res) => {
  const { pin } = z.object({ pin: z.string().regex(/^\d{4,8}$/, "Use 4 to 8 digits").nullable() }).parse(req.body);
  setPhonePin(role.parse(req.params.role), pin, { userId: req.user.id, demo: Boolean(req.demo) });
  res.json(phonesView());
});
teamPhonesRouter.post("/signout/:role", (req: any, res) => {
  signOutPhones(role.parse(req.params.role));
  res.json({ ok: true });
});
