/** /api/sync (signed in): settings sync across your Macs — status, and "Sync now". */
import { Router } from "express";
import { syncNow, syncStatus } from "../lib/sync.js";

export const syncRouter = Router();
syncRouter.get("/", (_req, res) => res.set("Cache-Control", "no-store").json(syncStatus()));
syncRouter.post("/", (_req, res, next) => { syncNow({ pull: true }).then((s) => res.json(s), next); });
