/**
 * How this Mac runs (Full Mode / Service Mode / FOH Companion; see lib/appMode.ts), and as an FOH
 * companion: linking to the main
 * computer, and the page requests it shows. Only reachable on this Mac (127.0.0.1), no sign-in needed:
 * a companion doesn't sign in to Planning Center at all.
 */
import { Router } from "express";
import { z } from "zod";
import { appMode, appModeView, lockServiceMode, setAppMode, unlockServiceMode } from "../lib/appMode.js";
import { act, pressTuning, companionState, findMains, linkTo, saveStrip, showCompanionWindow, startCompanion, stripSettings, unlink } from "../lib/companion.js";
import { boardDisplays } from "../lib/board.js";

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) =>
  fn(req, res).catch((e: Error) => res.status(400).json({ error: "companion", message: e.message }));

export const appModeRouter = Router();
const pinErr = (fn: (req: any, res: any) => unknown) => (req: any, res: any) => {
  try { fn(req, res); } catch (e) {
    const st = (e as { status?: number }).status ?? 400;
    res.status(st).json({ error: st === 403 ? "pin" : "invalid_request", message: (e as Error).message });
  }
};
const Pin = z.string().regex(/^\d{4,8}$/, "The PIN is 4 to 8 numbers.");
appModeRouter.get("/", (_req, res) => res.json(appModeView()));
appModeRouter.put("/", pinErr((req, res) => {
  const { mode, pin, newPin } = z.object({ mode: z.enum(["full", "service", "companion"]).nullable(), pin: z.string().max(12).optional(), newPin: Pin.optional() }).parse(req.body);
  const before = appMode();
  const v = setAppMode(mode, { pin, newPin });
  if ((before === "companion") !== (mode === "companion")) {
    startCompanion();
  }
  res.json(v);
}));
appModeRouter.post("/unlock", pinErr((req, res) => res.json(unlockServiceMode(z.object({ pin: z.string().max(12) }).parse(req.body).pin))));
appModeRouter.post("/lock", (_req, res) => res.json(lockServiceMode()));

export const companionClientRouter = Router();
companionClientRouter.get("/state", (_req, res) => res.json(companionState()));
companionClientRouter.get("/find", h(async (_req, res) => res.json(await findMains())));
companionClientRouter.post("/link", h(async (req, res) => {
  const { host, port, code } = z.object({ host: z.string().trim().min(1).max(255), port: z.number().int().min(1).max(65535), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }).parse(req.body);
  res.json(await linkTo(host, port, code));
}));
companionClientRouter.post("/unlink", h(async (_req, res) => { await unlink(); res.json(companionState()); }));
companionClientRouter.post("/act", h(async (req, res) => {
  const { id, action } = z.object({ id: z.string().max(60), action: z.enum(["accept", "hold", "deny"]) }).parse(req.body);
  res.json(await act(id, action));
}));

/** The mic strip (size, which display) and switching between it and the full companion window. */
companionClientRouter.get("/strip", (_req, res) => res.json({ settings: stripSettings(), displays: boardDisplays() }));
companionClientRouter.put("/strip", (req, res) => {
  const p = z.object({
    enabled: z.boolean(), size: z.enum(["s", "m", "l"]), displayId: z.number().nullable(), displayLabel: z.string().max(200).nullable(), tuning: z.boolean(),
  }).partial().parse(req.body);
  res.json({ settings: saveStrip(p), displays: boardDisplays() });
});
companionClientRouter.post("/window", (req, res) => {
  const { view } = z.object({ view: z.enum(["full", "strip"]) }).parse(req.body);
  showCompanionWindow(view);
  res.json({ ok: true });
});
companionClientRouter.post("/tuning", h(async (req, res) => {
  const { slot } = z.object({ slot: z.string().max(60) }).parse(req.body);
  res.json(await pressTuning(slot));
}));
