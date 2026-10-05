/** /api/cloud (signed in): where Sundays' cloud is, for Sundays | Operations (Supabase). */
import { Router } from "express";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../../../shared/cloud.js";

export const cloudRouter = Router();
cloudRouter.get("/", (_req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
    // COOL_OPS_URL / COOL_OPS_TEST_TOKEN: a local copy of the ops function, for testing.
    opsUrl: process.env.COOL_OPS_URL || `${SUPABASE_URL}/functions/v1/ops`,
    testToken: process.env.COOL_OPS_TEST_TOKEN || null,
  });
});
