/**
 * /api/updates: Check for Updates, driven by the Mac app's updater (desktop/src/updater.ts), which
 * registers itself here. In a browser (npm run dev) there's no updater, and Settings says so.
 */
import { Router } from "express";
import type { UpdateBridge, UpdateStatus } from "../../../shared/updates.js";

let bridge: UpdateBridge | null = null;
export const setUpdateBridge = (b: UpdateBridge) => { bridge = b; };

const none = (): UpdateStatus => ({
  state: "unavailable", current: process.env.APP_VERSION ?? "dev", repo: null, latest: null, progress: null,
  error: "Updates are checked by the Sundays Mac app.", checkedAt: null, installProblem: null,
});

export const updatesRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

updatesRouter.get("/", h(async (_req, res) => res.json(bridge ? bridge.status() : none())));
updatesRouter.post("/check", h(async (_req, res) => res.json(bridge ? await bridge.check() : none())));
updatesRouter.post("/install", h(async (_req, res) => res.json(bridge ? await bridge.install() : none())));
