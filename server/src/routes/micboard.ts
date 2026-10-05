/**
 * /api/micboard (signed in): Micboard running inside Sundays (see lib/micboard.ts) and
 * Preferences → Micboard: on/off, port, names and Planning Center photos, your backgrounds.
 */
import express, { Router } from "express";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { z } from "zod";
import {
  backgroundsDir, listBackgrounds, micboardData, micboardRunning, micboardSettings, micboardStatus, micboardSync,
  removeBackground, restartMicboard, saveBackground, saveMicboardSettings, syncNow,
} from "../lib/micboard.js";

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

/** The Mac app opens folders in Finder (set by desktop/src/main.ts). */
let openFolder: ((dir: string) => void) | null = null;
export const setFolderOpener = (fn: (dir: string) => void) => { openFolder = fn; };

function lanUrls(port: number) {
  const ips: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) for (const a of addrs ?? []) {
    if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) ips.push(a.address);
  }
  return ips.map((ip) => `http://${ip}:${port}`);
}

export const micboardRouter = Router();
micboardRouter.get("/", h(async (_req, res) => {
  const s = micboardSettings();
  const d = micboardRunning() ? await micboardData().catch(() => null) : null;
  res.json({
    settings: s, status: micboardStatus(), sync: micboardSync(), urls: lanUrls(s.port),
    groups: (d?.config.groups ?? []).map((g) => ({ group: g.group, title: g.title, slots: g.slots.length })).sort((a, b) => a.group - b.group),
    slots: d?.config.slots.length ?? 0, canOpenFolder: Boolean(openFolder),
    // The names on Micboard now (what its backgrounds are matched to).
    onBoard: [...new Set((d?.receivers ?? []).flatMap((r) => r.tx.map((t) => t.name?.trim())).filter((n): n is string => Boolean(n)))].sort(),
  });
}));
micboardRouter.put("/settings", (req, res) => {
  const p = z.object({
    enabled: z.boolean(), port: z.number().int().min(1024).max(65535).refine((n) => ![3000, 3001, 47123, 47124, 47125].includes(n), "That port is taken by Sundays"),
    names: z.enum(["first", "full", "off"]), pcoPhotos: z.boolean(),
  }).partial().parse(req.body);
  res.json(saveMicboardSettings(p));
});
/** QR code (SVG) for Micboard's address on the network. */
micboardRouter.get("/qr", h(async (req, res) => {
  const url = String(req.query.url ?? "");
  if (!lanUrls(micboardSettings().port).includes(url)) return res.status(400).json({ error: "not_our_address" });
  res.type("image/svg+xml").send(await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }));
}));
micboardRouter.post("/restart", (_req, res) => { restartMicboard(); res.json({ ok: true }); });
micboardRouter.post("/sync", h(async (_req, res) => { await syncNow(); res.json(micboardSync()); }));
micboardRouter.post("/open-folder", (req, res) => {
  const which = z.object({ which: z.enum(["backgrounds", "config"]) }).parse(req.body).which;
  if (!openFolder) return res.status(400).json({ error: "not_available", message: "Only in the Mac app" });
  openFolder(which === "backgrounds" ? backgroundsDir() : path.dirname(backgroundsDir()));
  res.json({ ok: true });
});

/* Backgrounds: Micboard shows <name>.jpg (or .mp4) behind that name. */
micboardRouter.get("/backgrounds", (_req, res) => res.json(listBackgrounds()));
micboardRouter.get("/backgrounds/file/:file", (req, res) => {
  const f = String(req.params.file);
  if (!/^[^/\\]+\.(jpg|mp4|gif)$/i.test(f)) return res.status(400).end();
  res.set("Cache-Control", "no-cache").sendFile(path.join(backgroundsDir(), f), (e) => { if (e && !res.headersSent) res.status(404).end(); });
});
micboardRouter.post("/backgrounds", (req, res) => {
  const { name, dataUrl } = z.object({ name: z.string().trim().min(1).max(60), dataUrl: z.string().max(20_000_000) }).parse(req.body);
  const m = dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: "invalid_request", message: "Send the picture as a JPEG" });
  res.json({ file: saveBackground(name, "jpg", Buffer.from(m[1], "base64")), list: listBackgrounds() });
});
micboardRouter.post("/backgrounds/video", express.raw({ type: "video/mp4", limit: "300mb" }), (req, res) => {
  const name = z.string().trim().min(1).max(60).parse(req.query.name);
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: "invalid_request", message: "Send an MP4 video" });
  res.json({ file: saveBackground(name, "mp4", req.body), list: listBackgrounds() });
});
micboardRouter.delete("/backgrounds/:file", (req, res) => { removeBackground(String(req.params.file)); res.json(listBackgrounds()); });
