/**
 * /api/updates: Check for Updates, driven by each Sundays app's own updater (desktop/src/updater.ts)
 * through lib/engine.ts: a window asks its own app. In a browser (npm run dev) there's no updater,
 * and Settings says so.
 */
import { Router } from "express";
import { appFromUserAgent } from "../../../shared/apps.js";
import type { UpdateStatus } from "../../../shared/updates.js";
import { appCall, type AppMethod } from "../lib/engine.js";

const none = (): UpdateStatus => ({
  state: "unavailable", current: process.env.APP_VERSION ?? "dev", repo: null, latest: null, progress: null,
  error: "Updates are checked by the Sundays Mac app.", checkedAt: null, installProblem: null,
});

export const updatesRouter = Router();
const ask = (method: AppMethod) => (req: any, res: any, next: any) =>
  appCall(appFromUserAgent(req.get("user-agent")), method).then((s) => res.json((s as UpdateStatus | undefined) ?? none())).catch(next);

updatesRouter.get("/", ask("updates.status"));
updatesRouter.post("/check", ask("updates.check"));
updatesRouter.post("/install", ask("updates.install"));
