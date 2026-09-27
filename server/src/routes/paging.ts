/**
 * /api/paging — staff side (signed in): ProPresenter setup, Kids/Nursery iPad setup, paging.
 */
import os from "node:os";
import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { MINISTRIES, type KioskAddresses, type Ministry } from "../../../shared/types.js";
import { discover, ProPresenter, ProPresenterError } from "../lib/propresenter.js";
import { page, PagingError, pp, publicConfig, saveConfig, setPin, signOutIpads, status, stored, testPage } from "../lib/paging.js";
import { childrenFor, kioskState } from "../kiosk.js";
import { checkInsDenied } from "../auth/oauth.js";

export const pagingRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch((e: unknown) => {
  if (e instanceof PagingError) return res.status(e.status).json({ error: e.code, message: e.message, status: status() });
  if (e instanceof ProPresenterError) return res.status(502).json({ error: "propresenter", message: e.message });
  next(e);
});
const ministry = z.enum(MINISTRIES as [Ministry, ...Ministry[]]);
const ProIdZ = z.object({ uuid: z.string().max(80), name: z.string().max(200), index: z.number().int() });

pagingRouter.get("/config", h(async (_req, res) => res.json(publicConfig())));

const MinistryPatch = z.object({
  enabled: z.boolean(),
  title: z.string().trim().min(1).max(40),
  locationIds: z.array(z.string().max(40)).max(200),
  mode: z.enum(["managed", "existing"]),
  text: z.string().trim().min(1).max(120).refine((t) => t.includes("{code}"), "Include {code} where the security code goes"),
  theme: ProIdZ.nullable(),
  existing: z.object({ id: ProIdZ, token: z.string().min(1).max(100) }).nullable(),
}).partial();

const ConfigPatch = z.object({
  propresenter: z.object({ host: z.string().trim().max(255).regex(/^[A-Za-z0-9.\-:]*$/, "Enter an IP address or computer name"), port: z.number().int().min(0).max(65535) }).partial(),
  onScreenSeconds: z.number().int().min(3).max(600),
  ipads: z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65535).refine((p) => p !== 3000 && p !== 3001, "Ports 3000 and 3001 aren't allowed") }).partial(),
  ministries: z.object({ nursery: MinistryPatch, kids: MinistryPatch }).partial(),
}).partial();

/** Saving makes you the "owner": the iPad pages read Check-Ins with your Planning Center access. */
pagingRouter.put("/config", h(async (req, res) => {
  const patch = ConfigPatch.parse(req.body);
  res.json(saveConfig(patch as Parameters<typeof saveConfig>[0], { userId: req.user.id, demo: Boolean(req.demo) }));
}));

pagingRouter.put("/pin/:ministry", h(async (req, res) => {
  const m = ministry.parse(req.params.ministry);
  const { pin } = z.object({ pin: z.string().regex(/^\d{4,8}$/, "Use 4 to 8 digits").nullable() }).parse(req.body);
  setPin(m, pin);
  saveConfig({}, { userId: req.user.id, demo: Boolean(req.demo) });
  res.json(publicConfig());
}));

pagingRouter.post("/signout/:ministry", h(async (req, res) => {
  signOutIpads(ministry.parse(req.params.ministry));
  res.json({ ok: true });
}));

/* ───────────── ProPresenter ───────────── */

pagingRouter.get("/discover", h(async (req, res) => {
  const port = Number(req.query.port) || stored().config.propresenter.port || undefined;
  res.json(await discover(port));
}));

pagingRouter.post("/connect-test", h(async (req, res) => {
  const { host, port } = z.object({ host: z.string().trim().min(1).max(255), port: z.number().int().min(1).max(65535) }).parse(req.body);
  res.json(await new ProPresenter(host, port).version());
}));

pagingRouter.get("/themes", h(async (_req, res) => res.json(await pp().themes())));
pagingRouter.get("/messages", h(async (_req, res) => res.json(await pp().messages())));

/* ───────────── Check-Ins rooms ───────────── */

pagingRouter.get("/locations", h(async (req, res) => {
  try {
    res.json(await req.pco.listCheckInLocations());
  } catch (e: any) {
    if (e?.status === 403 || e?.status === 401) return res.status(403).json(checkInsDenied(req, e));
    throw e;
  }
}));

/* ───────────── Paging ───────────── */

/** Staff view: each ministry's children checked in today (with the staff member's own access). */
pagingRouter.get("/children", h(async (req, res) => {
  const cfg = stored().config.ministries;
  const out: Record<string, unknown> = {};
  for (const m of MINISTRIES) out[m] = cfg[m].enabled ? await childrenFor(m, req.pco) : [];
  res.json(out);
}));

pagingRouter.get("/status", h(async (_req, res) => res.json(status())));

pagingRouter.post("/page", h(async (req, res) => {
  const b = z.object({ ministry, code: z.string().max(20), childName: z.string().max(120).nullable().optional() }).parse(req.body);
  const ev = await page(b.ministry, b.code, { by: req.user.name, actorId: req.user.id, childName: b.childName ?? null });
  res.json({ event: ev, status: status() });
}));

pagingRouter.post("/test/:ministry", h(async (req, res) => {
  const ev = await testPage(ministry.parse(req.params.ministry), `${req.user.name} (test)`, req.user.id);
  res.json({ event: ev, status: status() });
}));

/* ───────────── iPad addresses ───────────── */

export function kioskAddresses(): KioskAddresses {
  const { port } = stored().config.ipads;
  const ips: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) ips.push(a.address);
  }
  const host = os.hostname();
  const local = host ? (host.endsWith(".local") ? host : `${host}.local`) : null;
  const s = kioskState();
  return { urls: [...ips, ...(local ? [local] : [])].map((h) => `http://${h}:${port}`), port, running: s.running, error: s.error };
}

pagingRouter.get("/ipads", h(async (_req, res) => res.json(kioskAddresses())));

/** QR code (SVG) for one of our own iPad addresses. */
pagingRouter.get("/qr", h(async (req, res) => {
  const url = String(req.query.url ?? "");
  const ok = kioskAddresses().urls.some((u) => url === `${u}/nursery` || url === `${u}/kids`);
  if (!ok) return res.status(400).json({ error: "not_our_address" });
  res.type("image/svg+xml").send(await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }));
}));
