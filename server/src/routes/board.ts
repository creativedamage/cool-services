/**
 * /api/board (signed in): stage display settings, pictures, and what's showing.
 * /api/board-out (no sign-in; also on the network listener when the display is shared there): the
 * state every display draws, and the pictures it may show.
 */
import { Router } from "express";
import { z } from "zod";
import type { BoardMic } from "../../../shared/board.js";
import { files, mics } from "../lib/db.js";
import { boardDisplays, boardSettings, displayState, publicImage, saveBoardSettings, setBoardOwner, setOpenPlan } from "../lib/board.js";
import { kioskAddresses } from "./paging.js";

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const View = z.enum(["micboard", "clock"]);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const boardRouter = Router();
boardRouter.use((req: any, _res, next) => { if (req.user) setBoardOwner({ userId: req.user.id, demo: Boolean(req.demo) }); next(); });
boardRouter.get("/", h(async (_req, res) => {
  const a = kioskAddresses();
  const s = boardSettings();
  const setup = mics.setup();
  const mics_: BoardMic[] = setup.channels.map((c) => ({
    id: c.id, label: c.label, kind: c.kind, hidden: (s.hidden ?? []).includes(c.id),
    networked: Boolean(setup.receivers.find((r) => r.id === c.receiverId)?.ip),
  }));
  res.json({ settings: s, state: await displayState(), displays: boardDisplays(), urls: a.running ? a.urls.map((u) => `${u}/display`) : [], mics: mics_ });
}));
boardRouter.put("/settings", (req, res) => {
  const p = z.object({
    mode: z.enum(["auto", "micboard", "clock"]), autoIdle: View, follow: z.enum(["open", "next"]), serviceTypeId: z.string().max(40).nullable(),
    banner: z.object({ enabled: z.boolean(), text: z.string().max(400), scroll: z.boolean(), size: z.enum(["s", "m", "l"]), background: Color, color: Color, showService: z.boolean(), showClock: z.boolean() }).partial(),
    images: z.enum(["custom-then-pco", "pco", "custom", "none"]), imageStyle: z.enum(["background", "icon", "none"]),
    kinds: z.array(z.enum(["vocal", "pack", "other"])).max(3), hideUnassigned: z.boolean(), columns: z.number().int().min(0).max(12),
    hidden: z.array(z.string().max(60)).max(500), stack: z.boolean(),
    lan: z.boolean(), screen: z.object({ enabled: z.boolean(), displayId: z.number().nullable() }).partial(),
  }).partial().parse(req.body);
  res.json(saveBoardSettings(p as any));
});
/** The service you have open in Cool Services (the board follows it). */
boardRouter.post("/open", (req, res) => {
  const { serviceTypeId, planId } = z.object({ serviceTypeId: z.string().min(1).max(40), planId: z.string().min(1).max(40) }).parse(req.body);
  setOpenPlan(serviceTypeId, planId);
  res.json({ ok: true });
});
/** Add a mic that isn't on the network (it goes into Mic setup with no receiver). */
boardRouter.post("/mics", (req, res) => {
  const { label, kind } = z.object({ label: z.string().trim().min(1).max(40), kind: z.enum(["vocal", "pack", "other"]) }).parse(req.body);
  const setup = mics.setup();
  const id = `ch-${Date.now().toString(36)}`;
  mics.saveSetup({ ...setup, channels: [...setup.channels, { id, label, kind, receiverId: null, channel: 1, positions: [] }] });
  saveBoardSettings({}); // the board shows it right away
  res.json({ id });
});
/** Remove a mic that isn't on the network (networked ones are edited in Mic setup). */
boardRouter.delete("/mics/:id", (req, res) => {
  const setup = mics.setup();
  const c = setup.channels.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "not_found" });
  if (setup.receivers.find((r) => r.id === c.receiverId)?.ip) return res.status(400).json({ error: "networked", message: "That mic is on a receiver; change it in Mic setup." });
  mics.saveSetup({ ...setup, channels: setup.channels.filter((x) => x.id !== c.id) });
  saveBoardSettings({ hidden: (boardSettings().hidden ?? []).filter((x) => x !== c.id) });
  res.json({ ok: true });
});

const ImgKey = z.string().regex(/^(person|mic):[\w-]{1,40}$/);
boardRouter.post("/images", (req, res) => {
  const { key, dataUrl } = z.object({ key: ImgKey, dataUrl: z.string().max(12_000_000) }).parse(req.body);
  const m = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: "invalid_request", message: "Use a PNG, JPG or WebP picture" });
  const id = files.save(Buffer.from(m[2], "base64"), m[1] === "jpeg" ? "jpg" : (m[1] as "png" | "webp"));
  res.json(saveBoardSettings({ customImages: { ...boardSettings().customImages, [key]: id } }));
});
boardRouter.delete("/images/:key", (req, res) => {
  const key = ImgKey.parse(req.params.key);
  const next = { ...boardSettings().customImages };
  delete next[key];
  res.json(saveBoardSettings({ customImages: next }));
});

export const boardOutRouter = Router();
boardOutRouter.get("/state", h(async (_req, res) => res.set("Cache-Control", "no-store").json(await displayState())));
boardOutRouter.get("/image/:id", (req, res) => {
  const p = publicImage(req.params.id) ? files.path(req.params.id) : null;
  if (!p) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=31536000, immutable").sendFile(p);
});
