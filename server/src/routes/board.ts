/**
 * /api/board (signed in): stage display settings, pictures, and what's showing.
 * /api/board-out (no sign-in; also on the network listener when the display is shared there): the
 * state every display draws, and the pictures it may show.
 */
import { Router } from "express";
import { z } from "zod";
import type { BoardMic } from "../../../shared/board.js";
import { files, mics } from "../lib/db.js";
import { addBackground, addLogo, boardDisplays, boardSettings, displayState, pictureFrom, publicImage, removeBackground, removeLogo, renameBackground, setPlot, renameLogo, saveBoardSettings, setBoardOwner, setDefaultLogo, setLogoSchedule, setOpenPlan } from "../lib/board.js";
import { kioskAddresses } from "./paging.js";

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
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
    images: z.enum(["custom-then-pco", "pco", "custom", "none"]), imageStyle: z.enum(["background", "icon", "none"]),
    kinds: z.array(z.enum(["vocal", "pack", "other"])).max(3), hideUnassigned: z.boolean(), columns: z.number().int().min(0).max(6),
    hidden: z.array(z.string().max(60)).max(500), stack: z.boolean(), names: z.enum(["first", "full"]),
    tileText: z.record(z.string().max(60), z.string().max(60)), tileColor: z.record(z.string().max(60), Color),
    center: z.object({ clock: z.enum(["time", "production"]), seconds: z.boolean(), date: z.boolean() }).partial(),
    plot: z.object({ dark: z.boolean() }).partial(),
    lan: z.boolean(), screen: z.object({ enabled: z.boolean(), displayId: z.number().nullable() }).partial(),
  }).partial().parse(req.body);
  res.json(saveBoardSettings(p as any));
});
/** The service you have open in Sundays (the board follows it). */
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
const Pic = z.string().max(12_000_000);
const fail = (res: any, e: unknown) => res.status((e as { status?: number }).status ?? 400).json({ error: "invalid_request", message: (e as Error).message });

/** The backgrounds library: add (a picture, shrunk in the browser), rename, remove. */
boardRouter.post("/backgrounds", (req, res) => {
  const { name, dataUrl } = z.object({ name: z.string().max(80).default(""), dataUrl: Pic }).parse(req.body);
  try { const bg = addBackground(name, pictureFrom(dataUrl)); res.json({ background: bg, settings: boardSettings() }); } catch (e) { fail(res, e); }
});
boardRouter.put("/backgrounds/:id", (req, res) => {
  renameBackground(req.params.id, z.object({ name: z.string().min(1).max(80) }).parse(req.body).name);
  res.json(boardSettings());
});
boardRouter.delete("/backgrounds/:id", (req, res) => { removeBackground(req.params.id); res.json(boardSettings()); });

/** Pick a background for a person (wherever they are) or a mic; null goes back to automatic. */
boardRouter.put("/images", (req, res) => {
  const { key, backgroundId } = z.object({ key: ImgKey, backgroundId: z.string().max(80).nullable() }).parse(req.body);
  const next = { ...boardSettings().customImages };
  if (backgroundId && boardSettings().backgrounds.some((b) => b.id === backgroundId)) next[key] = backgroundId; else delete next[key];
  res.json(saveBoardSettings({ customImages: next }));
});

/** The stage plot under the clock: a picture made from the PDF in the browser. */
boardRouter.post("/plot", (req, res) => {
  const { name, dataUrl } = z.object({ name: z.string().max(120).default(""), dataUrl: Pic }).parse(req.body);
  try { setPlot(pictureFrom(dataUrl), name); res.json(boardSettings()); } catch (e) { fail(res, e); }
});
boardRouter.delete("/plot", (_req, res) => { setPlot(null, null); res.json(boardSettings()); });

/** Logos over the clock: the library, the default, and the schedule. */
boardRouter.post("/logos", (req, res) => {
  const { name, dataUrl } = z.object({ name: z.string().max(80).default(""), dataUrl: Pic }).parse(req.body);
  try { addLogo(name, pictureFrom(dataUrl)); res.json(boardSettings()); } catch (e) { fail(res, e); }
});
boardRouter.put("/logos/:id", (req, res) => { renameLogo(req.params.id, z.object({ name: z.string().min(1).max(80) }).parse(req.body).name); res.json(boardSettings()); });
boardRouter.delete("/logos/:id", (req, res) => { removeLogo(req.params.id); res.json(boardSettings()); });
boardRouter.put("/logo-default", (req, res) => { setDefaultLogo(z.object({ logoId: z.string().max(80).nullable() }).parse(req.body).logoId); res.json(boardSettings()); });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
boardRouter.put("/logo-schedule", (req, res) => {
  const { rules } = z.object({
    rules: z.array(z.object({
      id: z.string().min(1).max(40), logoId: z.string().max(80), date: Day, repeat: z.enum(["none", "daily", "weekly", "monthly", "yearly"]),
      days: z.array(z.number().int().min(0).max(6)).max(7).default([]), until: Day.nullable().default(null),
      from: Time.nullable().default(null), to: Time.nullable().default(null),
    }).refine((r) => !r.until || r.until >= r.date, "It can’t end before it starts.")
      .refine((r) => (r.from === null) === (r.to === null) && (r.from === null || r.from !== r.to), "Pick both times (or neither, for all day)."))
      .max(300),
  }).parse(req.body);
  setLogoSchedule(rules);
  res.json(boardSettings());
});

export const boardOutRouter = Router();
boardOutRouter.get("/state", h(async (_req, res) => res.set("Cache-Control", "no-store").json(await displayState())));
boardOutRouter.get("/image/:id", (req, res) => {
  const p = publicImage(req.params.id) ? files.path(req.params.id) : null;
  if (!p) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=31536000, immutable").sendFile(p);
});
