/**
 * "Sign in with Planning Center" — OAuth 2.0 authorization code + PKCE, server-side sessions.
 *
 * Staff just click "Sign in with Planning Center", log in on Planning Center's own page with their
 * normal account, and land on their boards. The site's Planning Center app credentials are part of
 * the server's configuration (set once at deploy time) and are never shown to anyone.
 *
 * Two data-access modes:
 *  - Per-person (default): data calls use each staff member's own sign-in, so their own
 *    Planning Center permissions apply.
 *  - Shared token (PCO_PAT_APP_ID + PCO_PAT_SECRET set): data calls use the server's Personal
 *    Access Token. Sign-in only confirms who someone is, and only people in the same church
 *    (Planning Center organization) as the token are let in.
 */
import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { config, pcoConfigured, usingPat } from "../config.js";
import { sessions, tokens as tokenStore, users } from "../lib/db.js";
import { decrypt, encrypt, randomId } from "../lib/crypto.js";
import { exchangeCode, PcoClient, type TokenSet } from "../pco/client.js";
import { LivePco } from "../pco/live.js";
import { DemoPco } from "../demo/demo.js";
import type { PcoApi } from "../pco/api.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; pcoPersonId: string; name: string };
      pco?: PcoApi;
      demo?: boolean;
    }
  }
}

const SID = "cc_sid";
const STATE = "cc_oauth_state";
const VERIFIER = "cc_pkce";
const RETURN = "cc_return";
/** Only our own pages ("/services/checkins?…"), never another site. */
const safeReturn = (v: unknown) => (typeof v === "string" && /^\/(?!\/)[\w\-/?=&.%#]*$/.test(v) ? v : null);
const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: config.appUrl.startsWith("https:"), path: "/" };
const demoApi = new DemoPco();
const web = (p: string) => `${config.webOrigin}${p}`;

/** Shared Personal Access Token client + the church (organization) it belongs to. */
const patClient = usingPat() ? PcoClient.withPersonalAccessToken(config.pco.patAppId, config.pco.patSecret) : null;
let patOrgId: Promise<string> | null = null;
const churchOrgId = () => (patOrgId ??= patClient!.get("/people/v2").then((o) => o.id));

async function startSession(res: Response, userId: string, demo = false) {
  const id = randomId();
  const expiresAt = new Date(Date.now() + config.sessionDays * 864e5);
  sessions.create({ id, userId, demo, expiresAt: expiresAt.toISOString() });
  res.cookie(SID, id, { ...cookieOpts, expires: expiresAt });
}

async function saveTokens(userId: string, t: TokenSet) {
  tokenStore.save({
    userId,
    accessTokenEnc: encrypt(t.accessToken),
    refreshTokenEnc: encrypt(t.refreshToken),
    scope: t.scope,
    expiresAt: t.expiresAt.toISOString(),
  });
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export const authRouter = Router();
/** Express 4 doesn't forward async errors — route them to the error handler. */
const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

/* ───────────── Status (for the sign-in page) ───────────── */

authRouter.get("/status", h(async (_req, res) => {
  res.json({ signInAvailable: pcoConfigured(), allowDemo: config.allowDemo });
}));

/* ───────────── Sign in ───────────── */

/** Step 1 — send the browser to Planning Center's sign-in / consent screen. */
authRouter.get("/login", h(async (req, res) => {
  const clientId = config.pco.clientId;
  if (!clientId) return res.redirect(web("/?error=sign_in_not_available"));

  const state = randomId(16);
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  res.cookie(STATE, state, { ...cookieOpts, maxAge: 10 * 60_000 });
  res.cookie(VERIFIER, verifier, { ...cookieOpts, maxAge: 10 * 60_000 });
  // "Sign in again" from a page comes back to that page.
  const back = safeReturn(req.query.return);
  if (back) res.cookie(RETURN, back, { ...cookieOpts, maxAge: 10 * 60_000 }); else res.clearCookie(RETURN, cookieOpts);

  const url = new URL(`${config.pco.base}/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: config.pco.redirectUri,
    response_type: "code",
    // With a shared token, sign-in only needs to identify the person.
    scope: usingPat() ? "people" : config.pco.scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  res.redirect(url.toString());
}));

/** Step 2 — Planning Center redirects back with ?code&state. */
authRouter.get("/callback", h(async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) return res.redirect(web(`/?error=${encodeURIComponent(error)}`));
  const verifier = req.cookies?.[VERIFIER];
  if (!code || !state || state !== req.cookies?.[STATE] || !verifier) {
    return res.redirect(web("/?error=invalid_state"));
  }
  res.clearCookie(STATE, cookieOpts);
  res.clearCookie(VERIFIER, cookieOpts);
  try {
    const tokens = await exchangeCode(code, verifier);
    const tmp = new PcoClient(tokens, async () => {}, "login");
    const me = await tmp.get("/people/v2/me?include=emails");
    const org = await tmp.get("/people/v2");
    // Only let in people from our church: the token's organization, or PCO_ORGANIZATION_ID if set.
    const requiredOrg = patClient ? await churchOrgId() : config.pco.orgId || null;
    if (requiredOrg && org.id !== requiredOrg) {
      return res.redirect(web("/?error=not_in_church"));
    }
    const user = users.upsert({
      pcoPersonId: me.id, pcoOrgId: org.id, name: me.name,
      avatarUrl: me.avatar ?? null, email: me.rel.emails?.[0]?.address ?? null,
    });
    if (!patClient) await saveTokens(user.id, tokens); // shared-token mode doesn't need personal tokens
    await startSession(res, user.id);
    const back = safeReturn(req.cookies?.[RETURN]);
    res.clearCookie(RETURN, cookieOpts);
    res.redirect(web(back ?? "/start"));
  } catch (e) {
    console.error("[oauth] callback failed", e);
    res.redirect(web("/?error=token_exchange_failed"));
  }
}));

/** "Explore with sample data" — a demo session that never touches Planning Center. */
authRouter.get("/demo", h(async (_req, res) => {
  if (!config.allowDemo) return res.redirect(web("/"));
  const user = users.upsert({ pcoPersonId: "demo", pcoOrgId: "demo", name: "Demo User", email: null, avatarUrl: null });
  await startSession(res, user.id, true);
  res.redirect(web("/start"));
}));

authRouter.post("/logout", h(async (req, res) => {
  const sid = req.cookies?.[SID];
  if (sid) sessions.delete(sid);
  res.clearCookie(SID, cookieOpts);
  res.json({ ok: true });
}));

authRouter.get("/me", requireAuth, h(async (req, res) => {
  res.json(await req.pco!.me());
}));

/* ───────────── Middleware ───────────── */

function currentSession(req: Request) {
  const sid = req.cookies?.[SID];
  const session = sid ? sessions.get(sid) : null;
  const user = session ? users.get(session.userId) : null;
  return session && user ? { ...session, user: { ...user, token: tokenStore.get(user.id) } } : null;
}

/**
 * Planning Center access for a user: demo data, the shared token, or their own sign-in.
 * Null if they need to sign in again. Also used by the Kids/Nursery iPad pages, which borrow the
 * access of the staff member who set them up.
 */
export function pcoForUser(userId: string, demo: boolean): PcoApi | null {
  if (demo) return demoApi;
  const u = users.get(userId);
  if (!u) return null;
  if (patClient) return new LivePco(patClient, u.pcoOrgId, u.pcoPersonId, u.pcoPersonId);
  const t = tokenStore.get(u.id);
  if (!t) return null;
  const tokens: TokenSet = {
    accessToken: decrypt(t.accessTokenEnc),
    refreshToken: decrypt(t.refreshTokenEnc),
    expiresAt: new Date(t.expiresAt),
    scope: t.scope,
  };
  const client = new PcoClient(tokens, (nt) => saveTokens(u.id, nt), u.pcoPersonId);
  return new LivePco(client, u.pcoOrgId, undefined, u.pcoPersonId);
}

/** Resolve session → user → per-request Planning Center API (live or demo). */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const session = currentSession(req);
    if (!session) return res.status(401).json({ error: "not_authenticated" });

    const u = session.user;
    req.user = { id: u.id, pcoPersonId: u.pcoPersonId, name: u.name };
    req.demo = session.demo;
    const pco = pcoForUser(u.id, session.demo);
    if (!pco) return res.status(401).json({ error: "reauth_required" });
    req.pco = pco;
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Planning Center said no to Check-Ins. Signing in again only helps if this sign-in was made before
 * Cool Services asked for Check-Ins access (the token doesn't include it) or has expired. Otherwise
 * the Planning Center account itself doesn't have Check-Ins permission, and signing in again would
 * just loop, so say that instead.
 */
export function checkInsDenied(req: Request, e: { status?: number; body?: unknown }) {
  const detail = ((e.body as { errors?: { detail?: string; title?: string }[] })?.errors?.[0]);
  const pcoSays = detail?.detail || detail?.title || null;
  if (e.status === 401) return { error: "checkins_signin", message: "Your Planning Center sign-in has expired. Sign in again.", pcoSays };
  if (patClient) {
    return { error: "checkins_permission", shared: true, pcoSays,
      message: "The Planning Center account Cool Services uses on this Mac (its personal access token) doesn’t have access to Check-Ins. Give that account Check-Ins access in Planning Center, or remove the token so people use their own sign-in." };
  }
  const scope = (req.user ? tokenStore.get(req.user.id)?.scope : "") ?? "";
  if (!scope.split(/[\s,]+/).includes("check_ins")) {
    // Just signed in and Planning Center still left Check-Ins out: another sign-in won't help.
    const last = req.user ? Date.parse(users.get(req.user.id)?.lastLoginAt ?? "") : NaN;
    if (Date.now() - last < 10 * 60_000) {
      return { error: "checkins_permission", shared: false, pcoSays,
        message: `Planning Center didn’t include Check-Ins when you signed in (it allowed: ${scope || "nothing"}). Check that the Planning Center account you sign in with can use Check-Ins${config.pco.scopes.includes("check_ins") ? "" : ", and that PCO_SCOPES includes check_ins"}.` };
    }
    return { error: "checkins_signin", message: "Sign in again and approve Check-Ins. It only takes a moment.", pcoSays };
  }
  return { error: "checkins_permission", shared: false, pcoSays,
    message: "Your Planning Center account doesn’t have permission to see Check-Ins. A Planning Center administrator can turn it on for you in People → your profile → Permissions → Check-Ins. Signing in again won’t change this." };
}
