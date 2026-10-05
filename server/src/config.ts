import "dotenv/config";
import { BUILT_IN_CLIENT_ID } from "./pco/registration.js";

const bool = (v: string | undefined, d = false) => (v === undefined || v === "" ? d : v === "true" || v === "1");
const isProd = process.env.NODE_ENV === "production";

/**
 * The address the app is served from. The Mac app sets http://127.0.0.1:<port>; browser
 * development uses http://localhost:5173. The Planning Center return address is derived from it.
 */
const appUrl = (process.env.APP_URL || "http://127.0.0.1:5173").replace(/\/+$/, "");

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  appUrl,
  webOrigin: appUrl,
  isProd,
  /** "Explore with sample data" link on the sign-in page. */
  allowDemo: bool(process.env.ALLOW_DEMO, true),
  /** Where the database file and generated encryption key live (mount this as a volume on the server). */
  dataDir: process.env.DATA_DIR || ".data",
  pco: {
    base: process.env.PCO_API_BASE || "https://api.planningcenteronline.com",
    /**
     * Sundays' Planning Center app. Built in (pco/registration.ts) so nobody has to enter
     * anything; the env var only overrides it. A Public app has no secret — leave it blank.
     */
    clientId: (process.env.PCO_CLIENT_ID || BUILT_IN_CLIENT_ID).trim(),
    clientSecret: (process.env.PCO_CLIENT_SECRET ?? "").trim(),
    redirectUri: process.env.PCO_REDIRECT_URI || `${appUrl}/api/auth/callback`,
    scopes: process.env.PCO_SCOPES || "people services check_ins",
    webhookSecret: process.env.PCO_WEBHOOK_SECRET ?? "",
    /**
     * Optional server Personal Access Token. When set, all data syncing uses this one token,
     * and "Sign in with Planning Center" is only used to confirm who someone is (and that they
     * belong to the same church as the token). When blank, each person's own sign-in is used.
     */
    /** Optional: only allow people from this Planning Center organization to sign in. */
    orgId: process.env.PCO_ORGANIZATION_ID ?? "",
    patAppId: (process.env.PCO_PAT_APP_ID ?? "").trim(),
    patSecret: (process.env.PCO_PAT_SECRET ?? "").trim(),
  },
  tokenKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
  sessionDays: 30,
};

export const pcoConfigured = () => Boolean(config.pco.clientId);
export const usingPat = () => Boolean(config.pco.patAppId && config.pco.patSecret);

if ([3000, 3001].includes(config.port)) {
  throw new Error("API_PORT may not be 3000 or 3001 — pick another port (default 4000).");
}
if (config.pco.clientId && config.pco.clientId === config.pco.patAppId) {
  console.warn("⚠️  PCO_CLIENT_ID is the same as your Personal Access Token's Application ID. The sign-in button needs the Client ID of an OAuth *application* instead (see README).");
}
