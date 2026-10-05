import { AsyncLocalStorage } from "node:async_hooks";
/**
 * Low-level Planning Center HTTP client.
 *  - Bearer auth with proactive + reactive (401) single-flight token refresh
 *  - Rate limiting (~100 req / 20s per user) with Retry-After backoff on 429
 *  - JSON:API flattening and links.next pagination
 */
import { config } from "../config.js";
import { logEvent, logSlow } from "../lib/db.js";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}

export interface JsonApiResource {
  id: string;
  type: string;
  attributes: Record<string, any>;
  relationships?: Record<string, { data: { id: string; type: string } | { id: string; type: string }[] | null }>;
}

export interface JsonApiDoc {
  data: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
  links?: { next?: string };
  meta?: { total_count?: number; next?: { offset: number } };
}

/** Flattened resource: attributes spread at top level, relationships resolved from `included` under `rel`. */
export type Flat = { id: string; type: string; rel: Record<string, any>; [attr: string]: any };

export class PcoError extends Error {
  /** productDenied: a 401 for one Planning Center product while the sign-in itself is fine. */
  constructor(public status: number, public body: unknown, msg: string, public productDenied = false) {
    super(msg);
  }
}

/* ───────────── OAuth token endpoint helpers ───────────── */

/** Authorization-code exchange, with PKCE for extra protection. */
export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
  return tokenRequest({
    grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: config.pco.redirectUri,
  });
}

export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const clientId = config.pco.clientId;
  if (!clientId) throw new PcoError(500, null, "Planning Center sign-in isn't configured on this server (PCO_CLIENT_ID)");
  const res = await fetch(`${config.pco.base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      ...body,
      client_id: clientId,
      // Kept on the server only; never sent to the browser.
      ...(config.pco.clientSecret ? { client_secret: config.pco.clientSecret } : {}),
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new PcoError(res.status, json, `PCO token request failed (${res.status}): ${json.error_description ?? json.error ?? ""}`);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + Number(json.expires_in ?? 7200) * 1000),
    scope: json.scope ?? config.pco.scopes,
  };
}

/** Planning Center requires every API request to identify the app. */
export const USER_AGENT = `Sundays/${process.env.APP_VERSION ?? "dev"}`;

/* ───────────── Rate limiter (per client instance / user) ───────────── */

/**
 * Requests made for background work (roster counts on the services list) run with low priority:
 * they may only use 60% of the rate budget, so opening a service never waits behind them.
 */
export const lowPriority = new AsyncLocalStorage<boolean>();

class Bucket {
  private stamps: number[] = [];
  constructor(private max = 95, private windowMs = 20_000) {}
  async take() {
    const cap = lowPriority.getStore() ? Math.floor(this.max * 0.6) : this.max;
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
      if (this.stamps.length < cap) {
        this.stamps.push(now);
        return;
      }
      await sleep(Math.max(50, this.windowMs - (now - this.stamps[this.stamps.length - cap]) + 25));
    }
  }
}
const buckets = new Map<string, Bucket>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────────── Client ───────────── */

/**
 * Refresh results by the refresh token they used. Planning Center accepts a refresh token only once,
 * so a request that was started with the old tokens gets the new ones from here instead of trying
 * the old refresh token again (which fails, and signed people out). Kept for 15 minutes.
 */
const refreshesInFlight = new Map<string, Promise<TokenSet>>();

/** Planning Center no longer accepts this sign-in (the refresh token was refused). */
export class SignedOutError extends Error {}

/**
 * When each access token last worked. Planning Center answers 401 (not 403) when a sign-in can't use
 * one product (e.g. Check-Ins) while it works fine for the others; that isn't an expired token, so it
 * must not trigger a refresh (every refresh rotates the tokens) or sign anyone out.
 */
const tokenLastOk = new Map<string, number>();
const worksElsewhere = (accessToken: string) => Date.now() - (tokenLastOk.get(accessToken) ?? 0) < 15 * 60_000;

export class PcoClient {
  private refreshing: Promise<TokenSet> | null = null;
  private bucket: Bucket;
  /** Set when this client uses a server Personal Access Token instead of a user's sign-in. */
  private basicAuth: string | null = null;

  constructor(
    private tokens: TokenSet,
    /** Persist rotated tokens (encrypted) — called after every refresh. */
    private onRefresh: (t: TokenSet) => Promise<void>,
    userKey: string,
    /** Newest saved tokens (another request may have refreshed them), and what to do if sign-in is dead. */
    private store?: { reload: () => TokenSet | null; signedOut: (why: string) => void },
  ) {
    if (!buckets.has(userKey)) buckets.set(userKey, new Bucket());
    this.bucket = buckets.get(userKey)!;
  }

  /** Client that authenticates with a Personal Access Token (Application ID + Secret). */
  static withPersonalAccessToken(appId: string, secret: string): PcoClient {
    const c = new PcoClient({ accessToken: "", refreshToken: "", expiresAt: new Date(8.64e15), scope: "" }, async () => {}, `pat:${appId}`);
    c.basicAuth = `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`;
    return c;
  }

  private async ensureFresh(force = false) {
    if (this.basicAuth) return; // PATs don't expire
    const left = this.tokens.expiresAt.getTime() - Date.now();
    if (!force && left > 60_000) return;
    // A 401 right after a refresh isn't an expired token: don't burn another refresh on it.
    if (force && left > 110 * 60_000) return;
    // Someone else may already have refreshed: start from the newest saved tokens.
    const saved = this.store?.reload();
    if (saved && saved.refreshToken !== this.tokens.refreshToken) {
      this.tokens = saved;
      if (!force && saved.expiresAt.getTime() - Date.now() > 60_000) return;
    }
    const rt = this.tokens.refreshToken;
    let p = refreshesInFlight.get(rt);
    if (!p) {
      p = refreshTokens(rt).then(async (t) => { await this.onRefresh(t); return t; });
      refreshesInFlight.set(rt, p);
      setTimeout(() => refreshesInFlight.delete(rt), 15 * 60_000).unref?.();
      p.catch(() => refreshesInFlight.delete(rt));
    }
    this.refreshing = p;
    try {
      this.tokens = await p;
    } catch (e) {
      // Refused: maybe another request rotated it a moment ago. Use theirs if so.
      const again = this.store?.reload();
      if (again && again.refreshToken !== rt && again.expiresAt.getTime() - Date.now() > 60_000) { this.tokens = again; return; }
      const why = e instanceof PcoError ? `${e.status} ${(e.body as { error?: string })?.error ?? ""}`.trim() : (e as Error).message;
      logEvent(`sign-in: Planning Center refused the refresh token (${why})`);
      if (e instanceof PcoError && e.status >= 400 && e.status < 500) {
        this.store?.signedOut(why);
        throw new SignedOutError("Planning Center signed you out. Sign in again.");
      }
      throw e;
    }
  }

  async raw(method: string, path: string, body?: unknown, attempt = 0): Promise<JsonApiDoc | null> {
    await this.ensureFresh();
    await this.bucket.take();
    const url = path.startsWith("http") ? path : `${config.pco.base}${path}`;
    const started = Date.now();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.basicAuth ?? `Bearer ${this.tokens.accessToken}`,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    logSlow(method, url, Date.now() - started, res.status);
    const where = `${method} ${path.replace(/^https?:\/\/[^/]+/, "").split("?")[0]}`;
    if (res.ok && !this.basicAuth) tokenLastOk.set(this.tokens.accessToken, Date.now());
    if (res.status === 401 && !this.basicAuth) {
      const json: any = await res.clone().json().catch(() => null);
      const detail = json?.errors?.[0]?.detail ?? json?.errors?.[0]?.title ?? "";
      // Not sure yet? Ask Planning Center who we are with the same token (cheap, and only on a 401).
      if (!worksElsewhere(this.tokens.accessToken) && !path.includes("/people/v2/me")) {
        const probe = await fetch(`${config.pco.base}/people/v2/me`, { headers: { Authorization: `Bearer ${this.tokens.accessToken}`, "User-Agent": USER_AGENT, Accept: "application/json" } }).catch(() => null);
        if (probe?.ok) tokenLastOk.set(this.tokens.accessToken, Date.now());
      }
      if (worksElsewhere(this.tokens.accessToken)) {
        // The sign-in works for other things: this product just isn't allowed for it.
        logEvent(`access: ${where} → 401 while the sign-in works elsewhere (${detail || "no detail"}); scopes: ${this.tokens.scope || "?"}`);
        throw new PcoError(401, json, `PCO ${where} → 401: ${detail}`, true);
      }
      if (attempt === 0) {
        await this.ensureFresh(true);
        return this.raw(method, path, body, attempt + 1);
      }
      logEvent(`sign-in: ${where} → 401 after refreshing (${detail || "no detail"})`);
    }
    // Planning Center hiccups (502/503/504): try a read once more.
    if (method === "GET" && [502, 503, 504].includes(res.status) && attempt < 2) {
      await sleep(600 + attempt * 800);
      return this.raw(method, path, body, attempt + 1);
    }
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get("Retry-After") ?? 2) * 1000;
      await sleep(wait + attempt * 500);
      return this.raw(method, path, body, attempt + 1);
    }
    if (res.status === 204) return null;
    const json: any = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = json?.errors?.[0]?.detail ?? json?.errors?.[0]?.title ?? res.statusText;
      throw new PcoError(res.status, json, `PCO ${method} ${path} → ${res.status}: ${detail}`);
    }
    return json;
  }

  /** GET a single resource or one page, flattened. */
  async get(path: string): Promise<Flat> {
    const doc = await this.raw("GET", path);
    return flatten(doc!)[0];
  }

  /** GET every page (follows links.next), flattened. */
  async list(path: string, maxPages = 20): Promise<Flat[]> {
    const out: Flat[] = [];
    let next: string | undefined = withParam(path, "per_page", "100");
    for (let i = 0; next && i < maxPages; i++) {
      const doc: JsonApiDoc | null = await this.raw("GET", next);
      if (!doc) break;
      out.push(...flatten(doc));
      next = doc.links?.next;
    }
    return out;
  }

  post(path: string, body?: unknown) {
    return this.raw("POST", path, body);
  }
  patch(path: string, body: unknown) {
    return this.raw("PATCH", path, body);
  }
  delete(path: string) {
    return this.raw("DELETE", path);
  }
}

function withParam(path: string, k: string, v: string) {
  return path.includes(`${k}=`) ? path : `${path}${path.includes("?") ? "&" : "?"}${k}=${v}`;
}

/** Merge JSON:API data + included into plain objects. */
export function flatten(doc: JsonApiDoc): Flat[] {
  const index = new Map<string, JsonApiResource>();
  for (const inc of doc.included ?? []) index.set(`${inc.type}:${inc.id}`, inc);
  const shallow = (r: JsonApiResource): Flat => ({ id: r.id, type: r.type, ...r.attributes, rel: {} });

  const resolve = (r: JsonApiResource): Flat => {
    const flat = shallow(r);
    for (const [name, rel] of Object.entries(r.relationships ?? {})) {
      const d = rel?.data;
      if (!d) continue;
      const lookup = (ref: { id: string; type: string }) => {
        const hit = index.get(`${ref.type}:${ref.id}`);
        return hit ? shallow(hit) : { id: ref.id, type: ref.type, rel: {} };
      };
      flat.rel[name] = Array.isArray(d) ? d.map(lookup) : lookup(d);
    }
    return flat;
  };
  const data = Array.isArray(doc.data) ? doc.data : [doc.data];
  return data.map(resolve);
}
