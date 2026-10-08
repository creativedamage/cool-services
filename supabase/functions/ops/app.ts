/**
 * API for Sundays | Operations and Sundays | AVL (Edge Function "ops"). Two apps on one sign-in:
 *  · Operations — the church's business: requests (technology, supplies, facilities work orders),
 *    and the people, teams, campuses and request types behind them.
 *  · AVL — quoting other churches: clients, quotes, vendors and price lists.
 *
 * Sign-in is Sundays' own (Supabase Auth: register, then a manager approves you). Every call checks
 * the person's role, AVL level and campus scope from the database (see lib/rbac.ts).
 *
 *   /ops/me · /ops/overview
 *   /ops/requests… · /ops/work
 *   /ops/avl/overview · /ops/clients… · /ops/quotes… · /ops/catalog · /ops/vendors… · /ops/avl/{people,business}…
 *   /ops/settings/{users,teams,request-types,supply-items,campuses,activity,organization,email,checkin}…
 *   /ops/checkin/…  team check-ins on the website, signed in with Planning Center (checkin.ts)
 */
import { z, ZodError } from "zod";
import {
  atLeast, can, canAccessCampus, canEditUser, canManageCampus, canViewActivity, checkUserGrant, effectiveAccess, grantableRoles,
  hasAvlAccess, hasOpsAccess, isAdmin, isAvlManager, isGlobalManager, roleLabel, seesAllCampuses,
} from "./lib/rbac.ts";
import { OPEN_STATUSES, type RequestKind } from "./lib/workflow.ts";
import { isDeletable, QUOTE_STATUSES, type QuoteStatus } from "./lib/state-machine.ts";
import { computeBill, effectiveModules, kindAllowed, MODULE_KEYS, type ModuleKey } from "./lib/billing.ts";
import type { AvlOverview, OpsSessionUser, OverviewData, QuoteRow, UserRow } from "./lib/types.ts";
import { ctx as reqCtx, defined, getAvl, getOrg, hasModule, inOrg, orgId, raw, HttpError, logActivity, sql } from "./db.ts";
import { account, checkEntry, loadOrg, myOrgs, pickOrg, requireUser, sessionUser, touch, type Account } from "./auth.ts";
import { addRequestComment, handlesRequests, performRequestAction, requestDetail, requestRows, submitRequest, workQueueWhere } from "./requests.ts";
import { isEmail, keyUpdate, relayAvailable, render, send, senderFor, type MailChoice } from "./mail.ts";
import { mailSettings } from "./notify.ts";
import { ConfigSchema, checkinSettings, handleCheckin, saveCheckinSettings } from "./checkin.ts";
import { checkinLevelFor, CHECKIN_RANK } from "./lib/checkin.ts";
import { applyEvent, createQuote, effectiveTotals, liveTotals, loadQuote, quoteDTO, saveQuote, toPublicQuote, type FullQuote } from "./quotes.ts";
import { BudgetSchema, budgetOf, createJob, jobDetail, jobDocuments, jobFromQuote, jobRows, JobSchema, saveBudget } from "./jobs.ts";
import { emailProposal, notifyAnswer } from "./avlmail.ts";
import { activityRows, ActivitySchema, clientActivityWhere, createLead, dueAtDate, ensureClient, followUps, leadDetail, leadGetsJob, leadRows, LeadSchema, moveLead, sourceReport, sourcesInUse } from "./crm.ts";
import { OPEN_STAGES, stageLabel, type LeadPage, type LeadReport, type LeadsBoard } from "./lib/crm.ts";
import type { ClientProposalPage, JobPage, JobsList, JobStatus } from "./lib/jobs.ts";

type U = OpsSessionUser;
type Ctx = { req: Request; url: URL; params: Record<string, string>; body: () => Promise<any>; acc: Account };
type Handler = (c: Ctx) => Promise<unknown>;
/**
 * public   — no sign-in (pricing).
 * account  — signed in, no organization needed (who am I, create an organization).
 * org      — inside the caller's current organization (X-Org), as ops_app with row-level security.
 * platform — Sundays super admins only (the admin console), across organizations.
 */
type Scope = "public" | "account" | "org" | "platform";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-org",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const routes: { method: string; re: RegExp; keys: string[]; fn: Handler; scope: Scope }[] = [];
function route(method: string, path: string, fn: Handler, scope: Scope = "org") {
  const keys: string[] = [];
  const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; })}$`);
  routes.push({ method, re, keys, fn, scope });
}

async function run(r: (typeof routes)[number], c: Omit<Ctx, "acc">): Promise<unknown> {
  if (r.scope === "public") return r.fn({ ...c, acc: null as unknown as Account });
  const acc = await account(c.req);
  if (r.scope === "account") return r.fn({ ...c, acc });
  if (r.scope === "platform") {
    if (!acc.platform) throw new HttpError(403, "Sundays super admins only.");
    return r.fn({ ...c, acc });
  }
  const e = await pickOrg(acc, c.req);
  if (!e) throw new HttpError(403, "Create or join an organization first.", { status: "no-org" });
  checkEntry(acc, e);
  const user = await sessionUser(e.member, acc.platform);
  await touch(e.member);
  return inOrg(e, async () => { reqCtx()!.user = user; return r.fn({ ...c, acc }); });
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  // /functions/v1/ops/x, /ops/x → /x
  const path = url.pathname.replace(/^.*?\/ops(?=\/|$)/, "") || "/";
  if (path.startsWith("/checkin/")) return handleCheckin(req, path, url);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      let parsed: unknown;
      const out = await run(r, { req, url, params, body: async () => (parsed ??= await req.json().catch(() => ({}))) });
      return json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
      if (e instanceof ZodError) {
        const i = e.issues[0];
        return json({ error: i ? `${i.path.join(".") || "Input"}: ${i.message}` : "Invalid input", issues: e.issues }, 422);
      }
      const pg = e as { code?: string; detail?: string };
      if (pg.code === "23505") return json({ error: "That already exists." }, 409);
      if (pg.code === "23503") return json({ error: "That's still in use, or refers to something that's gone." }, 409);
      console.error(e);
      return json({ error: "Server error" }, 500);
    }
  }
  return json({ error: "Not found" }, 404);
}

/* ───────────── Guards ───────────── */

const avl = async (req: Request, perm?: "QUOTE_APPROVE" | "AVL_PURCHASING") => {
  const u = await requireUser(req);
  if (!hasModule("avl")) throw new HttpError(403, "AVL isn't part of this organization's plan.");
  if (!hasAvlAccess(u)) throw new HttpError(403, "AVL access required");
  if (perm && !can(u, perm)) throw new HttpError(403, "An AVL Manager has to do that.");
  return u;
};
/** Someone who uses Sundays | Operations. */
const opsUser = async (req: Request) => {
  const u = await requireUser(req);
  if (!hasOpsAccess(u)) throw new HttpError(403, "You don't have Sundays | Operations access.");
  return u;
};
const manager = async (req: Request) => {
  const u = await opsUser(req);
  if (!atLeast(u, "MANAGER")) throw new HttpError(403, "Manager access required");
  return u;
};
const avlManager = async (req: Request) => {
  const u = await requireUser(req);
  if (!isAvlManager(u)) throw new HttpError(403, "An AVL Manager has to do that.");
  return u;
};
const admin = async (req: Request) => {
  const u = await requireUser(req);
  if (!isAdmin(u)) throw new HttpError(403, "System admin access required");
  return u;
};
/** Only with this module on the organization's plan. */
const needModule = (k: ModuleKey, what: string) => { if (!hasModule(k)) throw new HttpError(403, `${what} isn't part of this organization's plan.`); };
/** Campuses this organization works with: all of them with the Multiple campuses module, otherwise its first. */
async function usableCampuses() {
  const all = await sql`select id, name from ops.campuses where active order by sort_order, name`;
  return hasModule("campuses") ? all : all.slice(0, 1);
}
const globalOnly = (u: U, what: string) => { if (!isGlobalManager(u)) throw new HttpError(403, `Only global managers and executives can ${what}.`); };

const optStr = (max = 200) => z.string().max(max).nullish().transform((v) => (v ? v : null));
const id = z.string().min(1);
const optId = z.string().max(60).nullish().or(z.literal("")).transform((v) => v || null);

/* ───────────── Me / organization brand ───────────── */

async function brand() {
  const org = await getOrg();
  const branded = hasModule("branding");
  const assets = branded ? await sql`select key, mime, data_b64 from ops.org_assets where key in ('logo', 'logo-dark')` : [];
  const a = (k: string) => assets.find((x) => x.key === k);
  return {
    id: org.id as string, name: org.name as string | null, logo: dataUrl(a("logo")), logoDark: dataUrl(a("logo-dark") ?? a("logo")),
    status: org.status, trialEndsAt: org.trialEndsAt ? new Date(org.trialEndsAt).toISOString() : null, modules: reqCtx()!.modules,
  };
}
const dataUrl = (x?: Record<string, any>) => (x ? `data:${x.mime};base64,${x.dataB64}` : null);
/** AVL's letterhead: its own logo, else the church's. */
async function avlLogo() {
  if (!hasModule("branding")) return null;
  const assets = await sql`select key, mime, data_b64 from ops.org_assets where key in ('avl-logo', 'logo')`;
  return dataUrl(assets.find((x) => x.key === "avl-logo") ?? assets.find((x) => x.key === "logo"));
}

route("GET", "/me", async ({ req }) => {
  const acc = await account(req, true);
  const base = { email: acc.auth.email, orgs: myOrgs(acc), platform: acc.platform };
  const e = await pickOrg(acc, req);
  if (!e) return { ...base, status: "no-org" };
  try { checkEntry(acc, e); } catch (err) {
    const status = (err as HttpError).extra?.status;
    return inOrg(e, async () => ({ ...base, status, name: e.member.name, org: await brand() }));
  }
  const user = await sessionUser(e.member, acc.platform);
  await touch(e.member);
  return inOrg(e, async () => { reqCtx()!.user = user; return { ...base, ...(await meInOrg()) }; });
}, "account");

async function meInOrg() {
  const u = await requireUser();
  const org = await brand();
  const ops = hasOpsAccess(u);
  const avlOn = hasModule("avl") && hasAvlAccess(u);
  const handles = ops && (await handlesRequests(u));
  const [[{ n: queueCount }], [{ n: pendingUsers }], [campus], [{ n: avlPending }], avl] = await Promise.all([
    handles ? sql`select count(*)::int as n from ops.requests r where ${workQueueWhere(u, { openOnly: true })}` : [{ n: 0 }],
    ops && atLeast(u, "MANAGER")
      ? sql`select count(*)::int as n from ops.users where pending and source <> 'PLATFORM' ${seesAllCampuses(u) ? sql`` : sql`and (campus_id = ${u.campusId} or campus_id is null)`}`
      : [{ n: 0 }],
    u.campusId && hasModule("campuses") ? sql`select name from ops.campuses where id = ${u.campusId}` : [],
    avlOn && isAvlManager(u) ? sql`select count(*)::int as n from ops.users where pending and source <> 'PLATFORM'` : [{ n: 0 }],
    avlOn ? getAvl() : null,
  ]);
  return {
    status: "ok" as const, user: u, org,
    nav: {
      handlesRequests: handles, queueCount, pendingUsers, manager: ops && atLeast(u, "MANAGER"), admin: isAdmin(u), campusName: campus?.name ?? null,
      ops, avl: avlOn, avlManager: avlOn && isAvlManager(u), avlPending, avlName: avl?.name ?? null, avlChurch: avl?.businessType === "CHURCH", modules: reqCtx()!.modules, platform: !!u.platform,
    },
  };
}

/** Sundays fills in the church name from Planning Center the first time (only if it's still empty). */
route("POST", "/bootstrap", async ({ req, body }) => {
  await requireUser(req);
  const { orgName } = z.object({ orgName: z.string().min(1).max(200) }).parse(await body());
  await sql`update ops.organization set name = ${orgName.trim()}, updated_at = now() where id = ${orgId()} and (name is null or name = '')`;
  return brand();
});

/* ───────────── Overview ───────────── */

const quoteRow = (q: FullQuote): QuoteRow => {
  const t = effectiveTotals(q);
  return {
    id: q.id, number: q.number, title: q.title, status: q.status, createdAt: q.createdAt, updatedAt: q.updatedAt, sentAt: q.sentAt ?? null, validUntil: q.validUntil ?? null,
    customer: { name: q.customer.name, contactName: q.customer.contactName }, campus: q.campusName ? { name: q.campusName } : null,
    totalCents: t.totalCents, marginBps: t.marginBps,
  };
};

/** Quotes with items and customer, in two queries (for lists and totals). */
async function quotesWith(where: unknown, opts: { limit?: number; order?: unknown } = {}): Promise<FullQuote[]> {
  const qs = await sql`select q.*, ca.name as campus_name from ops.quotes q left join ops.campuses ca on ca.id = q.campus_id
    where ${where as never} order by ${(opts.order ?? sql`q.updated_at desc`) as never} limit ${opts.limit ?? 200}`;
  if (!qs.length) return [];
  const ids = qs.map((q) => q.id as string);
  const [items, customers, payments] = await Promise.all([
    sql`select quote_id, quantity, unit_cost_cents, unit_price_cents, taxable from ops.quote_items where quote_id = any(${ids})`,
    sql`select * from ops.customers where id = any(${[...new Set(qs.map((q) => q.customerId as string))]})`,
    sql`select quote_id, status, amount_cents from ops.payments where quote_id = any(${ids})`,
  ]);
  return qs.map((q) => ({
    ...q, items: items.filter((i) => i.quoteId === q.id), customer: customers.find((c) => c.id === q.customerId), signature: null,
    payments: payments.filter((p) => p.quoteId === q.id),
  })) as unknown as FullQuote[];
}

route("GET", "/overview", async ({ req }) => {
  const u = await opsUser(req);
  const handles = await handlesRequests(u);
  const seesAll = atLeast(u, "MANAGER") && seesAllCampuses(u);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  let queue: OverviewData["queue"] = null;
  if (handles) {
    const base = workQueueWhere(u);
    const notApproval = OPEN_STATUSES.filter((s) => s !== "PENDING_APPROVAL");
    const [[{ n: approval }], [{ n: open }], [{ n: urgent }], [{ n: doneWeek }]] = await Promise.all([
      sql`select count(*)::int as n from ops.requests r where ${base} and r.status = 'PENDING_APPROVAL'`,
      sql`select count(*)::int as n from ops.requests r where ${base} and r.status = any(${notApproval})`,
      sql`select count(*)::int as n from ops.requests r where ${base} and r.status = any(${OPEN_STATUSES}) and r.priority in ('HIGH','URGENT')`,
      sql`select count(*)::int as n from ops.requests r where ${base} and r.status = 'COMPLETED' and r.completed_at >= ${weekAgo}`,
    ]);
    queue = { approval, open, urgent, doneWeek };
  }
  const [mineOpen, [{ n: completed30 }]] = await Promise.all([
    requestRows(sql`r.requester_id = ${u.id} and r.status = any(${OPEN_STATUSES})`, sql`r.created_at desc`, 5),
    sql`select count(*)::int as n from ops.requests where requester_id = ${u.id} and status = 'COMPLETED' and completed_at >= ${new Date(Date.now() - 30 * 86_400_000)}`,
  ]);
  // Operations' activity only (AVL keeps its own).
  const scope = seesAll ? sql`a.area <> 'AVL'` : sql`a.area <> 'AVL' and (a.actor_id = ${u.id}
    ${atLeast(u, "MANAGER") && u.campusId ? sql`or a.campus_id = ${u.campusId}` : sql``})`;
  const activity = await sql`select a.id, a.actor_label, a.action, a.detail, a.area, a.href, a.created_at, x.name as actor_name
    from ops.activity_log a left join ops.users x on x.id = a.actor_id where ${scope} order by a.created_at desc limit 8`;
  const [{ n: awaiting }] = await sql`select count(*)::int as n from ops.requests where requester_id = ${u.id} and status = 'PENDING_APPROVAL'`;
  return {
    queue, mine: { open: mineOpen, awaiting, completed30 }, activity, canViewActivity: canViewActivity(u),
  } satisfies Record<keyof OverviewData, unknown>;
});

/* ───────────── Requests ───────────── */

route("GET", "/requests/mine", async ({ req }) => {
  const u = await opsUser(req);
  return requestRows(sql`r.requester_id = ${u.id}`, sql`r.created_at desc`, 200);
});

route("GET", "/requests/new", async ({ req }) => {
  const u = await opsUser(req);
  const [cats, items, campuses] = await Promise.all([
    sql`select id, name, kind, workflow, description, icon, requires_location, allow_line_items, approval_threshold_cents
        from ops.request_categories where active order by sort_order, name`,
    sql`select id, category_id, name, unit, unit_cost_cents from ops.supply_items where active order by sort_order, name`,
    usableCampuses(),
  ]);
  const mods = reqCtx()!.modules;
  return {
    categories: cats.filter((c) => kindAllowed(c.kind, mods)).map((c) => ({
      ...c, allowLineItems: c.allowLineItems && hasModule("supplies"),
      supplyItems: hasModule("supplies") ? items.filter((i) => i.categoryId === c.id).map(({ categoryId: _c, ...i }) => i) : [],
    })),
    campuses, defaultCampusId: campuses.some((c) => c.id === u.campusId) ? u.campusId : campuses[0]?.id ?? null,
  };
});

route("POST", "/requests", async ({ req, body }) => {
  const u = await opsUser(req);
  const input = z.object({
    categoryId: id, campusId: id, title: z.string().min(1).max(200), details: z.string().max(5000).default(""),
    location: z.string().max(200).nullish(), quantity: z.number().int().min(1).max(1000).default(1),
    unitEstimateCents: z.number().int().min(0).max(100_000_000).nullish(), neededBy: z.string().nullish(),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
    lines: z.array(z.object({ supplyItemId: z.string().nullish(), description: z.string().max(200).nullish(), quantity: z.number().int().min(0).max(10_000) })).max(100).optional(),
  }).parse(await body());
  const r = await submitRequest(u, input);
  return { id: r.id, number: r.number, status: r.status };
});

route("GET", "/requests/:id", async ({ req, params }) => requestDetail(await opsUser(req), params.id));

route("POST", "/requests/:id/actions", async ({ req, params, body }) => {
  const u = await opsUser(req);
  const input = z.object({
    action: z.enum(["APPROVE", "DENY", "ASSIGN", "START", "HOLD", "ORDER", "COMPLETE", "CANCEL", "REOPEN"]),
    note: z.string().max(5000).optional(), assigneeId: z.string().optional(),
  }).parse(await body());
  const r = await performRequestAction(u, params.id, input);
  return { status: r.status };
});

route("POST", "/requests/:id/comments", async ({ req, params, body }) => {
  const u = await opsUser(req);
  const { body: text, internal } = z.object({ body: z.string().min(1).max(5000), internal: z.boolean().default(false) }).parse(await body());
  return addRequestComment(u, params.id, text, internal);
});

const WORK_TABS = ["open", "approval", "mine", "done"] as const;
route("GET", "/work", async ({ req, url }) => {
  const u = await opsUser(req);
  if (!(await handlesRequests(u))) throw new HttpError(403, "Nothing is routed to your teams.");
  const tab = WORK_TABS.find((t) => t === url.searchParams.get("tab")) ?? "open";
  const kind = (["TECHNOLOGY", "SUPPLY", "MAINTENANCE", "OTHER"] as RequestKind[]).find((k) => k === url.searchParams.get("kind"));
  const campus = url.searchParams.get("campus") || null;
  const base = workQueueWhere(u);
  const notApproval = OPEN_STATUSES.filter((s) => s !== "PENDING_APPROVAL");
  const tabWhere = (t: (typeof WORK_TABS)[number]) =>
    t === "approval" ? sql`r.status = 'PENDING_APPROVAL'`
      : t === "mine" ? sql`r.assignee_id = ${u.id} and r.status = any(${OPEN_STATUSES})`
      : t === "done" ? sql`r.status in ('COMPLETED','CANCELLED','DENIED')`
      : sql`r.status = any(${notApproval})`;
  const filters = sql`${kind ? sql`and r.category_id in (select id from ops.request_categories where kind = ${kind})` : sql``}
    ${campus ? sql`and r.campus_id = ${campus}` : sql``}`;
  const [rows, counts, campuses] = await Promise.all([
    requestRows(sql`${base} and ${tabWhere(tab)} ${filters}`,
      tab === "done" ? sql`r.updated_at desc` : sql`array_position(array['URGENT','HIGH','NORMAL','LOW'], r.priority), r.created_at`, 300),
    Promise.all(WORK_TABS.map(async (t) => (t === "done" ? null : (await sql`select count(*)::int as n from ops.requests r where ${base} and ${tabWhere(t)}`)[0].n))),
    seesAllCampuses(u) && hasModule("campuses") ? sql`select id, name from ops.campuses where active order by sort_order, name` : [],
  ]);
  return {
    tab, rows, counts: Object.fromEntries(WORK_TABS.map((t, i) => [t, counts[i]])), campuses,
    description: atLeast(u, "MANAGER")
      ? seesAllCampuses(u) ? "Every request at every campus." : "Every request at your campus, plus anything routed to your teams."
      : "Requests routed to your teams, and approvals waiting on you.",
  };
});

/* ───────────── Quotes ───────────── */

route("GET", "/quotes", async ({ req, url }) => {
  const u = await avl(req);
  const status = QUOTE_STATUSES.find((s) => s === url.searchParams.get("status")) as QuoteStatus | undefined;
  const campus = url.searchParams.get("campus") || null;
  const client = url.searchParams.get("client") || null;
  const q = url.searchParams.get("q")?.trim();
  const like = q ? `%${q}%` : null;
  const [quotes, counts, customers, campuses] = await Promise.all([
    quotesWith(sql`true ${status ? sql`and q.status = ${status}` : sql``} ${campus ? sql`and q.campus_id = ${campus}` : sql``} ${client ? sql`and q.customer_id = ${client}` : sql``}
      ${like ? sql`and (q.number ilike ${like} or q.title ilike ${like} or q.customer_id in (select id from ops.customers where name ilike ${like}))` : sql``}`),
    sql`select status, count(*)::int as n from ops.quotes group by status`,
    sql`select id, name from ops.customers where active order by name`,
    sql`select id, name from ops.campuses where active order by sort_order, name`,
  ]);
  return { quotes: quotes.map(quoteRow), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), customers, campuses, defaultCampusId: u.campusId };
});

route("POST", "/quotes", async ({ req, body }) => {
  const u = await avl(req);
  const input = z.object({ title: z.string().min(1).max(200), customerId: id, campusId: z.string().nullish() }).parse(await body());
  const q = await createQuote({ ...input, createdById: u.id });
  await logActivity({ actorId: u.id, action: "Created quote", detail: `${q.number} · ${q.title}`, area: "AVL", entityType: "Quote", entityId: q.id, href: `/avl/quotes/view?id=${q.id}`, campusId: q.campusId });
  return { id: q.id, number: q.number };
});

route("GET", "/quotes/:id", async ({ req, params }) => {
  const u = await avl(req);
  const [quote, customers, vendors, campuses, org] = await Promise.all([
    quoteDTO(params.id),
    sql`select id, name, email, tax_exempt from ops.customers where active or id = (select customer_id from ops.quotes where id = ${params.id}) order by name`,
    sql`select id, name from ops.vendors where active order by name`,
    sql`select id, name from ops.campuses where active order by sort_order, name`,
    getAvl(),
  ]);
  return { quote, customers, vendors, campuses, defaultMarginBps: org.defaultMarginBps, laborRateCents: org.laborRateCents, canApprove: can(u, "QUOTE_APPROVE") };
});

const cents = z.number().int().min(0).max(1_000_000_000);
route("PUT", "/quotes/:id", async ({ req, params, body }) => {
  const u = await avl(req);
  const input = z.object({
    title: z.string().min(1).max(200), customerId: id, campusId: z.string().nullish(),
    introNotes: z.string().max(10_000).nullish(), internalNotes: z.string().max(10_000).nullish(), terms: z.string().max(20_000).nullish(),
    taxBps: z.number().int().min(0).max(5000), discountCents: cents, depositBps: z.number().int().min(0).max(10_000), validUntil: z.string().nullish(),
    items: z.array(z.object({
      productId: z.string().nullish(), isCustom: z.boolean(), section: z.string().max(80).nullish(), sku: z.string().max(120).nullish(),
      name: z.string().min(1).max(300), description: z.string().max(5000).nullish(), quantity: z.number().int().min(1).max(100_000),
      unitCostCents: cents, unitPriceCents: cents, taxable: z.boolean(),
    })).max(500),
  }).parse(await body());
  await saveQuote(params.id, u.id, input);
  return quoteDTO(params.id);
});

route("DELETE", "/quotes/:id", async ({ req, params }) => {
  const u = await avl(req);
  const [q] = await sql`select status, number, title from ops.quotes where id = ${params.id}`;
  if (!q) throw new HttpError(404, "Quote not found");
  if (!isDeletable(q.status)) throw new HttpError(409, `A ${q.status} quote cannot be deleted.`);
  await sql`delete from ops.quotes where id = ${params.id}`;
  await logActivity({ actorId: u.id, action: "Deleted quote", detail: `${q.number} · ${q.title}`, area: "AVL" });
});

route("POST", "/quotes/:id/events", async ({ req, params, body }) => {
  const { event, note, emailTo } = z.object({
    event: z.enum(["SEND", "REVISE", "REOPEN", "CONVERT", "MARK_ACCEPTED", "MARK_CHANGES", "MARK_DECLINED"]), note: z.string().max(5000).optional(),
    /** SEND: email the proposal link here (the client's address, or another). */
    emailTo: z.string().email().max(200).nullish(),
  }).parse(await body());
  const u = await avl(req, event === "CONVERT" || event === "MARK_ACCEPTED" ? "QUOTE_APPROVE" : undefined);
  const q = await applyEvent({ quoteId: params.id, event, actor: "staff", actorId: u.id, note: note ?? (event === "SEND" ? "Pricing locked for the customer" : null) });
  // A converted proposal is a job.
  if (event === "CONVERT") await jobFromQuote(q.id, u.id);
  const emailedTo = event === "SEND" && emailTo ? await emailProposal(q.id, emailTo) : null;
  const verb = { SEND: "Sent quote", REVISE: "Revised quote", REOPEN: "Reopened quote", CONVERT: "Converted quote", MARK_ACCEPTED: "Recorded acceptance", MARK_CHANGES: "Recorded change request", MARK_DECLINED: "Recorded decline" }[event];
  await logActivity({ actorId: u.id, action: verb, detail: emailedTo ? `${q.number} · emailed to ${emailedTo}` : q.number, area: "AVL", entityType: "Quote", entityId: q.id, href: `/avl/quotes/view?id=${q.id}`, campusId: q.campusId });
  return { ...(await quoteDTO(params.id)), emailedTo };
});

/** Email the proposal link (again) to the client, or to another address. */
route("POST", "/quotes/:id/email", async ({ req, params, body }) => {
  const u = await avl(req);
  const { to } = z.object({ to: z.string().email().max(200) }).parse(await body());
  const [q] = await sql`select status, number from ops.quotes where id = ${params.id}`;
  if (!q) throw new HttpError(404, "Quote not found");
  if (q.status === "DRAFT") throw new HttpError(409, "Send (lock) the proposal first.");
  const emailedTo = await emailProposal(params.id, to);
  if (!emailedTo) throw new HttpError(409, "Email is turned off for this organization (Operations → Settings → Organization → Email). Copy the link instead.");
  await logActivity({ actorId: u.id, action: "Emailed proposal", detail: `${q.number} · ${emailedTo}`, area: "AVL", entityType: "Quote", entityId: params.id, href: `/avl/quotes/view?id=${params.id}` });
  return { emailedTo };
});

/** Make the job for an accepted proposal (marks the proposal converted). */
route("POST", "/quotes/:id/job", async ({ req, params }) => {
  const u = await avl(req, "QUOTE_APPROVE");
  const [q] = await sql`select status, number from ops.quotes where id = ${params.id}`;
  if (!q) throw new HttpError(404, "Quote not found");
  if (q.status === "ACCEPTED") await applyEvent({ quoteId: params.id, event: "CONVERT", actor: "staff", actorId: u.id, note: "Job created" });
  else if (q.status !== "CONVERTED") throw new HttpError(409, "The client has to accept the proposal first.");
  const job = await jobFromQuote(params.id, u.id);
  await leadGetsJob(params.id, job.id);
  if (job.created) await logActivity({ actorId: u.id, action: "Created job", detail: `${job.number} from ${q.number}`, area: "AVL", entityType: "Job", entityId: job.id, href: `/avl/jobs/view?id=${job.id}` });
  return job;
});

/** Print preview / PDF: exactly what the customer gets (no cost, margin or internal notes). */
route("GET", "/quotes/:id/print", async ({ req, params }) => {
  await avl(req);
  const [q, biz, org, logo] = await Promise.all([loadQuote(params.id), getAvl(), getOrg(), avlLogo()]);
  const { id: _i, updatedAt: _u, ...settings } = biz;
  // AVL's letterhead; until it has its own name, the church's.
  return { quote: toPublicQuote(q), org: { ...settings, name: settings.name ?? org.name, taxExempt: false }, logo };
});

route("POST", "/customers", async ({ req, body }) => {
  await avl(req);
  const input = z.object({
    name: z.string().min(1).max(200), contactName: z.string().max(200).nullish(), email: z.string().email().nullish().or(z.literal("")).transform((v) => v || null),
    phone: z.string().max(50).nullish(), taxExempt: z.boolean().default(false),
  }).parse(await body());
  const [c] = await sql`insert into ops.customers ${sql(defined(input))} returning id, name, email, tax_exempt`;
  if (input.contactName) await sql`insert into ops.customer_contacts ${sql({ customerId: c.id, name: input.contactName, email: input.email, phone: input.phone ?? null, isPrimary: true })}`;
  return c;
});

/* ───────────── AVL: jobs ───────────── */

const JOB_STATUS_IDS: JobStatus[] = ["PLANNING", "IN_PROGRESS", "ON_HOLD", "COMPLETE", "CANCELLED"];
route("GET", "/jobs", async ({ req, url }) => {
  await avl(req);
  const status = JOB_STATUS_IDS.find((s) => s === url.searchParams.get("status"));
  const open = url.searchParams.get("status") === "open";
  const client = url.searchParams.get("client") || null;
  const q = url.searchParams.get("q")?.trim();
  const like = q ? `%${q}%` : null;
  const [jobs, counts, customers, biz] = await Promise.all([
    jobRows(sql`true ${status ? sql`and j.status = ${status}` : open ? sql`and j.status in ('PLANNING','IN_PROGRESS','ON_HOLD')` : sql``}
      ${client ? sql`and j.customer_id = ${client}` : sql``}
      ${like ? sql`and (j.number ilike ${like} or j.name ilike ${like} or j.site_line1 ilike ${like} or j.site_city ilike ${like} or c.name ilike ${like})` : sql``}`),
    sql`select status, count(*)::int as n from ops.jobs group by status`,
    sql`select id, name from ops.customers where active order by name`,
    getAvl(),
  ]);
  return {
    jobs, counts: Object.fromEntries(JOB_STATUS_IDS.map((s) => [s, counts.find((c) => c.status === s)?.n ?? 0])) as JobsList["counts"],
    customers: customers as unknown as JobsList["customers"], businessType: biz.businessType,
  } satisfies JobsList;
});

route("POST", "/jobs", async ({ req, body }) => {
  const u = await avl(req);
  const raw = await body();
  const input = JobSchema.parse(raw);
  const job = await createJob(input, u.id, raw?.startWithGroups !== false);
  await logActivity({ actorId: u.id, action: "Created job", detail: `${job.number} · ${input.name}`, area: "AVL", entityType: "Job", entityId: job.id, href: `/avl/jobs/view?id=${job.id}` });
  return job;
});

route("GET", "/jobs/:id", async ({ req, params }) => {
  await avl(req);
  const job = await jobDetail(params.id);
  const [budget, documents, customers, people, biz] = await Promise.all([
    budgetOf(job.id), jobDocuments(job),
    sql`select id, name from ops.customers where active or id = ${job.customerId} order by name`,
    sql`select id, name from ops.users where active and not pending and source <> 'PLATFORM' and (avl_level <> 'NONE' or role = 'ADMIN' or id = ${job.managerId}) order by name`,
    getAvl(),
  ]);
  return { job, budget, documents, customers, people, businessType: biz.businessType, canEdit: true } as unknown as JobPage;
});

route("PUT", "/jobs/:id", async ({ req, params, body }) => {
  const u = await avl(req);
  const input = JobSchema.parse(await body());
  const [j] = await sql`update ops.jobs set ${sql({ ...input, updatedAt: new Date() })} where id = ${params.id} returning id, number, name`;
  if (!j) throw new HttpError(404, "Job not found");
  await logActivity({ actorId: u.id, action: "Updated job", detail: `${j.number} · ${j.name}`, area: "AVL", entityType: "Job", entityId: j.id, href: `/avl/jobs/view?id=${j.id}` });
  return jobDetail(j.id);
});

route("PUT", "/jobs/:id/budget", async ({ req, params, body }) => {
  const u = await avl(req);
  const { items } = z.object({ items: BudgetSchema }).parse(await body());
  const out = await saveBudget(params.id, items);
  const [j] = await sql`select number, name from ops.jobs where id = ${params.id}`;
  await logActivity({ actorId: u.id, action: "Updated job budget", detail: `${j.number} · ${j.name}`, area: "AVL", entityType: "Job", entityId: params.id, href: `/avl/jobs/view?id=${params.id}&tab=budget` });
  return out;
});

route("DELETE", "/jobs/:id", async ({ req, params }) => {
  const u = await avlManager(req);
  const [j] = await sql`delete from ops.jobs where id = ${params.id} returning number, name, quote_id`;
  if (!j) throw new HttpError(404, "Job not found");
  // Its proposal can make a new job again.
  await logActivity({ actorId: u.id, action: "Deleted job", detail: `${j.number} · ${j.name}`, area: "AVL" });
});

/* ───────────── AVL: leads (CRM) ───────────── */

const STAGE = z.enum(["NEW", "CONTACTED", "SITE_VISIT", "PROPOSAL", "WON", "LOST"]);
const avlPeople = () => sql`select id, name from ops.users where active and not pending and source <> 'PLATFORM' and (avl_level <> 'NONE' or role = 'ADMIN') order by name`;
const clientRefs = () => sql`select id, name from ops.customers where active order by name`;
const leadHref = (id: string) => `/avl/leads/view?id=${id}`;
/** Integrators only: a church team doesn't sell. */
const leadsUser = async (req: Request) => {
  const u = await avl(req);
  if ((await getAvl()).businessType === "CHURCH") throw new HttpError(403, "Leads are for integrators. Change how you use AVL in AVL → Settings.");
  return u;
};

route("GET", "/leads", async ({ req, url }) => {
  await leadsUser(req);
  const q = url.searchParams.get("q")?.trim();
  const like = q ? `%${q}%` : null;
  const closedDays = url.searchParams.get("closed") === "all" ? 100_000 : 90;
  const [leads, people, customers, sources] = await Promise.all([
    leadRows(sql`(l.stage in ${sql(OPEN_STAGES)} or coalesce(l.won_at, l.lost_at, l.updated_at) > now() - make_interval(days => ${closedDays}))
      ${like ? sql`and (l.title ilike ${like} or l.org_name ilike ${like} or l.contact_name ilike ${like} or c.name ilike ${like} or l.city ilike ${like})` : sql``}`),
    avlPeople(), clientRefs(), sourcesInUse(),
  ]);
  return { leads: leads.map(({ notes: _n, customerId: _c, ownerId: _o, createdBy: _b, createdById: _bi, ...l }) => l), closedDays, people, customers, sources } as unknown as LeadsBoard;
});

route("POST", "/leads", async ({ req, body }) => {
  const u = await leadsUser(req);
  const raw = await body();
  const input = LeadSchema.parse(raw);
  if (!input.customerId && !input.orgName) throw new HttpError(422, "Pick a client or type the church’s name.");
  const fu = raw?.followUp?.dueAt ? { body: String(raw.followUp.body || "Follow up").slice(0, 500), dueAt: dueAtDate(String(raw.followUp.dueAt)).toISOString() } : null;
  const id = await createLead(input, u.id, { note: typeof raw?.note === "string" ? raw.note.slice(0, 20_000) : null, followUp: fu });
  await logActivity({ actorId: u.id, action: "Added lead", detail: input.title, area: "AVL", entityType: "Lead", entityId: id, href: leadHref(id) });
  return { id };
});

route("GET", "/leads/report", async ({ req, url }) => {
  await leadsUser(req);
  const since = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("since") ?? "") ? url.searchParams.get("since")! : `${new Date().getFullYear()}-01-01`;
  return { since, ...(await sourceReport(since)) } satisfies LeadReport;
});

route("GET", "/leads/:id", async ({ req, params }) => {
  await leadsUser(req);
  const lead = await leadDetail(params.id);
  const [activities, people, customers, sources] = await Promise.all([
    activityRows(sql`a.lead_id = ${lead.id}`), avlPeople(), clientRefs(), sourcesInUse(),
  ]);
  return { lead, activities, people, customers, sources } as unknown as LeadPage;
});

route("PUT", "/leads/:id", async ({ req, params, body }) => {
  const u = await leadsUser(req);
  const input = LeadSchema.parse(await body());
  if (!input.customerId && !input.orgName) throw new HttpError(422, "Pick a client or type the church’s name.");
  const [l] = await sql`update ops.leads set ${sql({ ...input, updatedAt: new Date() })} where id = ${params.id} returning id, title`;
  if (!l) throw new HttpError(404, "Lead not found");
  await logActivity({ actorId: u.id, action: "Updated lead", detail: l.title, area: "AVL", entityType: "Lead", entityId: l.id, href: leadHref(l.id) });
  return leadDetail(l.id);
});

/**
 * Move a lead on the board (a stage, and optionally its place in the column). Won can make the job:
 * from the lead's proposal when the client accepted it, otherwise a new job for the lead's client.
 */
route("POST", "/leads/:id/move", async ({ req, params, body }) => {
  const u = await leadsUser(req);
  const input = z.object({
    stage: STAGE, position: z.number().finite().nullish(), lostReason: z.string().trim().max(500).nullish(), createJob: z.boolean().default(false),
  }).parse(await body());
  const before = await leadDetail(params.id);
  await sql.begin((tx) => moveLead(tx, params.id, input.stage, { position: input.position ?? null, userId: u.id, lostReason: input.lostReason ?? undefined }));
  let job: { id: string; number: string } | null = before.job;
  if (input.stage === "WON" && input.createJob && !job) {
    const q = before.quote ? (await sql`select status from ops.quotes where id = ${before.quote.id}`)[0] : null;
    if (q && ["ACCEPTED", "CONVERTED"].includes(q.status)) {
      if (!can(u, "QUOTE_APPROVE")) throw new HttpError(403, "An AVL Manager has to make the job from the proposal.");
      if (q.status === "ACCEPTED") await applyEvent({ quoteId: before.quote!.id, event: "CONVERT", actor: "staff", actorId: u.id, note: "Job created" });
      job = await jobFromQuote(before.quote!.id, u.id);
    } else {
      const customerId = await ensureClient(params.id);
      job = await createJob(JobSchema.parse({ name: before.title, customerId, siteCity: before.city, siteState: before.state, managerId: before.ownerId }), u.id, true);
    }
    await sql`update ops.leads set job_id = ${job.id} where id = ${params.id}`;
    await logActivity({ actorId: u.id, action: "Created job", detail: `${job.number} from lead ${before.title}`, area: "AVL", entityType: "Job", entityId: job.id, href: `/avl/jobs/view?id=${job.id}` });
  }
  if (before.stage !== input.stage) await logActivity({ actorId: u.id, action: `Moved lead to ${stageLabel(input.stage)}`, detail: before.title, area: "AVL", entityType: "Lead", entityId: params.id, href: leadHref(params.id) });
  return { lead: await leadDetail(params.id), job };
});

/** Start the lead's proposal: makes the client from the lead if it isn't one yet. */
route("POST", "/leads/:id/proposal", async ({ req, params }) => {
  const u = await leadsUser(req);
  const lead = await leadDetail(params.id);
  if (lead.quote) return { id: lead.quote.id, number: lead.quote.number, created: false };
  const customerId = await ensureClient(params.id);
  const q = await createQuote({ title: lead.title, customerId, createdById: u.id });
  await sql`update ops.leads set quote_id = ${q.id}, updated_at = now() where id = ${params.id}`;
  await logActivity({ actorId: u.id, action: "Created quote", detail: `${q.number} · ${q.title} (from a lead)`, area: "AVL", entityType: "Quote", entityId: q.id, href: `/avl/quotes/view?id=${q.id}` });
  return { id: q.id, number: q.number, created: true };
});

route("DELETE", "/leads/:id", async ({ req, params }) => {
  const u = await leadsUser(req);
  const [l] = await sql`select title, created_by_id from ops.leads where id = ${params.id}`;
  if (!l) throw new HttpError(404, "Lead not found");
  if (l.createdById !== u.id && !isAvlManager(u)) throw new HttpError(403, "Only whoever added the lead, or an AVL Manager, can delete it.");
  await sql`delete from ops.leads where id = ${params.id}`;
  await logActivity({ actorId: u.id, action: "Deleted lead", detail: l.title, area: "AVL" });
});

/* ───────────── AVL: activity (notes, calls, follow-ups) on leads, clients and jobs ───────────── */

route("GET", "/activities", async ({ req, url }) => {
  await avl(req);
  const p = url.searchParams;
  const where = p.get("lead") ? sql`a.lead_id = ${p.get("lead")}` : p.get("job") ? sql`a.job_id = ${p.get("job")}` : p.get("client") ? clientActivityWhere(p.get("client")!) : null;
  if (!where) throw new HttpError(422, "Say whose activity: lead, client or job.");
  return activityRows(where);
});

route("GET", "/followups", async ({ req, url }) => {
  const u = await avl(req);
  const everyone = url.searchParams.get("who") === "everyone";
  return followUps(everyone ? sql`true` : sql`(a.assigned_to_id = ${u.id} or (a.assigned_to_id is null and a.created_by_id = ${u.id}))`);
});

route("POST", "/activities", async ({ req, body }) => {
  const u = await avl(req);
  const a = ActivitySchema.parse(await body());
  const [row] = await sql`insert into ops.activities ${sql({
    kind: a.kind, body: a.body, leadId: a.leadId, customerId: a.customerId, jobId: a.jobId,
    dueAt: a.dueAt ? dueAtDate(a.dueAt) : null, assignedToId: a.dueAt ? (a.assignedToId ?? u.id) : a.assignedToId, createdById: u.id,
  })} returning id`;
  if (a.leadId) await sql`update ops.leads set updated_at = now() where id = ${a.leadId}`;
  return (await activityRows(sql`a.id = ${row.id}`))[0];
});

route("PUT", "/activities/:id", async ({ req, params, body }) => {
  const u = await avl(req);
  const input = z.object({
    body: z.string().trim().max(20_000).optional(), done: z.boolean().optional(),
    dueAt: z.string().max(40).nullish(), assignedToId: z.string().max(60).nullish(),
  }).parse(await body());
  const [cur] = await sql`select created_by_id, kind from ops.activities where id = ${params.id}`;
  if (!cur) throw new HttpError(404, "Not found");
  if (cur.kind === "STAGE") throw new HttpError(409, "Stage changes can't be edited.");
  const data: Record<string, unknown> = { updatedAt: new Date() };
  // Anyone can tick a follow-up off; changing what it says is for whoever wrote it, or a manager.
  if (input.done !== undefined) data.doneAt = input.done ? new Date() : null;
  if (input.body !== undefined || input.dueAt !== undefined || input.assignedToId !== undefined) {
    if (cur.createdById !== u.id && !isAvlManager(u)) throw new HttpError(403, "Only whoever wrote this, or an AVL Manager, can change it.");
    if (input.body !== undefined) data.body = input.body;
    if (input.dueAt !== undefined) data.dueAt = input.dueAt ? dueAtDate(input.dueAt) : null;
    if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId || null;
  }
  await sql`update ops.activities set ${sql(data)} where id = ${params.id}`;
  return (await activityRows(sql`a.id = ${params.id}`))[0];
});

route("DELETE", "/activities/:id", async ({ req, params }) => {
  const u = await avl(req);
  const [cur] = await sql`select created_by_id, kind from ops.activities where id = ${params.id}`;
  if (!cur) throw new HttpError(404, "Not found");
  if (cur.kind === "STAGE") throw new HttpError(409, "Stage changes stay on the timeline.");
  if (cur.createdById !== u.id && !isAvlManager(u)) throw new HttpError(403, "Only whoever wrote this, or an AVL Manager, can delete it.");
  await sql`delete from ops.activities where id = ${params.id}`;
});

/* ───────────── AVL: the client's proposal page (no sign-in: the link is the key) ───────────── */

/** The proposal behind a link, and its organization (it must still have AVL). */
async function proposalByToken(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) throw new HttpError(404, "This proposal link isn’t right. Ask for a new one.");
  const [q] = await raw`select id, org_id, token_expires_at from ops.quotes where public_token = ${token}`;
  if (!q || (q.tokenExpiresAt && new Date(q.tokenExpiresAt) < new Date())) throw new HttpError(404, "This proposal link isn’t right, or has expired. Ask for a new one.");
  const o = await loadOrg(q.orgId);
  if (!o || !o.modules.includes("avl")) throw new HttpError(404, "This proposal isn’t available any more.");
  return { quoteId: q.id as string, org: { id: q.orgId as string, row: o.row, modules: o.modules } };
}
const inProposal = <T>(token: string, fn: (quoteId: string) => Promise<T>) =>
  proposalByToken(token).then(({ quoteId, org }) => inOrg(org, () => fn(quoteId)));

async function clientProposal(quoteId: string): Promise<ClientProposalPage> {
  const [q, biz, org, logo] = await Promise.all([loadQuote(quoteId), getAvl(), getOrg(), avlLogo()]);
  if (q.status === "DRAFT") throw new HttpError(409, "This proposal is being updated. You’ll get the new version soon.", { status: "draft" });
  const { id: _i, updatedAt: _u, ...settings } = biz;
  const expired = q.status === "SENT" && Boolean(q.validUntil) && new Date(q.validUntil).getTime() + 86_400_000 < Date.now();
  const [last] = await sql`select type, note, created_at from ops.quote_events where quote_id = ${quoteId} and type in ('REQUEST_CHANGES','DECLINE','MARK_CHANGES','MARK_DECLINED') order by created_at desc limit 1`;
  return {
    quote: toPublicQuote(q), org: { ...settings, name: settings.name ?? org.name } as ClientProposalPage["org"], logo, expired,
    canAnswer: q.status === "SENT" && !expired,
    signature: q.signature ? { signerName: q.signature.signerName, signerTitle: q.signature.signerTitle ?? null, signedAt: new Date(q.signature.signedAt).toISOString(), totalCents: q.signature.totalCentsAtSigning } : null,
    answer: last && (q.status === "CHANGES_REQUESTED" || q.status === "DECLINED")
      ? { kind: /DECLINE/.test(last.type) ? "DECLINED" : "CHANGES", note: last.note ?? null, at: new Date(last.createdAt).toISOString() } : null,
  };
}

route("GET", "/public/proposals/:token", async ({ params }) => inProposal(params.token, async (id) => {
  await sql`update ops.quotes set viewed_at = now() where id = ${id} and viewed_at is null and status = 'SENT'`;
  return clientProposal(id);
}), "public");

const SignSchema = z.object({
  name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200), title: z.string().trim().max(120).nullish().transform((v) => v || null),
  /** The signature as drawn (PNG), or typed (then drawn from the name on the page). */
  signature: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(400_000),
  /** The total the client saw: if the proposal changed since, they have to look again. */
  totalCents: z.number().int(),
  agree: z.literal(true),
});
const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || null;

route("POST", "/public/proposals/:token/sign", async ({ req, params, body }) => {
  const input = SignSchema.parse(await body());
  return inProposal(params.token, async (id) => {
    const page = await clientProposal(id);
    if (!page.canAnswer) throw new HttpError(409, page.expired ? "This proposal has expired. Ask for a new one." : "This proposal can’t be signed any more.");
    if (page.quote.totals.totalCents !== input.totalCents) throw new HttpError(409, "The proposal changed while you had it open. Look it over again, then sign.", { status: "changed" });
    await sql`delete from ops.quote_signatures where quote_id = ${id}`;
    await sql`insert into ops.quote_signatures ${sql({
      quoteId: id, signerName: input.name, signerEmail: input.email, signerTitle: input.title, imageDataUrl: input.signature,
      totalCentsAtSigning: input.totalCents, ipAddress: clientIp(req), userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    })}`;
    const q = await applyEvent({ quoteId: id, event: "ACCEPT", actor: "system", actorLabel: `${input.name} (client)`, note: `Signed online by ${input.name}${input.title ? `, ${input.title}` : ""} (${input.email})` });
    await logActivity({ actorId: null, actorLabel: `${input.name} (client)`, action: "Client signed proposal", detail: `${q.number} · ${q.title}`, area: "AVL", entityType: "Quote", entityId: id, href: `/avl/quotes/view?id=${id}` });
    await notifyAnswer("SIGNED", id, input.name);
    return clientProposal(id);
  });
}, "public");

const AnswerSchema = z.object({ name: z.string().trim().max(120).nullish(), note: z.string().trim().max(5000).nullish() });
for (const [path, event, kind] of [["changes", "REQUEST_CHANGES", "CHANGES"], ["decline", "DECLINE", "DECLINED"]] as const) {
  route("POST", `/public/proposals/:token/${path}`, async ({ params, body }) => {
    const { name, note } = AnswerSchema.parse(await body());
    if (kind === "CHANGES" && !note) throw new HttpError(422, "Tell us what you’d like changed.");
    return inProposal(params.token, async (id) => {
      const page = await clientProposal(id);
      if (!page.canAnswer) throw new HttpError(409, "This proposal can’t be answered any more.");
      const who = name?.trim() || page.quote.customer.contactName || page.quote.customer.name;
      const q = await applyEvent({ quoteId: id, event, actor: "customer", actorLabel: `${who} (client)`, note: note ?? null });
      await logActivity({ actorId: null, actorLabel: `${who} (client)`, action: kind === "CHANGES" ? "Client asked for changes" : "Client declined proposal", detail: `${q.number} · ${q.title}`, area: "AVL", entityType: "Quote", entityId: id, href: `/avl/quotes/view?id=${id}` });
      await notifyAnswer(kind, id, who, note);
      return clientProposal(id);
    });
  }, "public");
}

/* ───────────── AVL: overview ───────────── */

route("GET", "/avl/overview", async ({ req }) => {
  const u = await avl(req);
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const [active, accepted, [{ open }], recent, [{ n: clients }], activity] = await Promise.all([
    quotesWith(sql`q.status in ('DRAFT','SENT','CHANGES_REQUESTED')`, { limit: 1000 }),
    quotesWith(sql`q.status in ('ACCEPTED','CONVERTED') and q.accepted_at >= ${yearStart}`, { limit: 1000 }),
    sql`select coalesce(sum(i.quantity * i.unit_cost_cents), 0)::bigint as open from ops.purchase_order_items i join ops.purchase_orders p on p.id = i.po_id where p.status in ('DRAFT','ORDERED','PARTIAL')`,
    quotesWith(sql`true`, { limit: 6 }),
    sql`select count(*)::int as n from ops.customers where active`,
    sql`select a.id, a.actor_label, a.action, a.detail, a.area, a.href, a.created_at, x.name as actor_name
      from ops.activity_log a left join ops.users x on x.id = a.actor_id where a.area = 'AVL' order by a.created_at desc limit 8`,
  ]);
  const OPEN_JOBS = sql`j.status in ('PLANNING','IN_PROGRESS','ON_HOLD')`;
  const [openJobRows, biz, [leadSum], fu] = await Promise.all([
    jobRows(OPEN_JOBS, 1000), getAvl(),
    sql`select count(*)::int as n, coalesce(sum(value_cents), 0)::bigint as v from ops.leads where stage in ${sql(OPEN_STAGES)}`,
    followUps(sql`(a.assigned_to_id = ${u.id} or (a.assigned_to_id is null and a.created_by_id = ${u.id}))`),
  ]);
  return {
    openLeads: leadSum.n, openLeadsCents: Number(leadSum.v), followUps: fu,
    jobs: openJobRows.slice(0, 6), openJobs: openJobRows.length, openJobsCostCents: openJobRows.reduce((s, j) => s + j.costCents, 0), businessType: biz.businessType,
    pipelineCents: active.reduce((s, q) => s + effectiveTotals(q).totalCents, 0),
    acceptedCents: accepted.reduce((s, q) => s + effectiveTotals(q).totalCents, 0),
    profitCents: accepted.reduce((s, q) => s + liveTotals(q).grossProfitCents, 0),
    openPurchasingCents: Number(open), clients, recent: recent.map(quoteRow), activity,
  } satisfies Record<keyof AvlOverview, unknown>;
});

/* ───────────── AVL: clients (the churches AVL works for) ───────────── */

const ClientSchema = z.object({
  name: z.string().min(1).max(200), website: optStr(300), phone: optStr(50),
  email: z.string().email().nullish().or(z.literal("")).transform((v) => v || null),
  addressLine1: optStr(), addressLine2: optStr(), city: optStr(100), state: optStr(50), postalCode: optStr(20),
  taxExempt: z.boolean().default(false), notes: optStr(10_000), active: z.boolean().default(true),
});
const ContactSchema = z.object({
  name: z.string().min(1).max(200), title: optStr(), email: z.string().email().nullish().or(z.literal("")).transform((v) => v || null),
  phone: optStr(50), isPrimary: z.boolean().default(false),
});

/** Keep customers.contact_name / email (used on proposals) in step with the primary contact. */
async function syncPrimary(customerId: string) {
  const [p] = await sql`select name, email, phone from ops.customer_contacts where customer_id = ${customerId} order by is_primary desc, created_at limit 1`;
  await sql`update ops.customers set contact_name = ${p?.name ?? null}, email = coalesce(${p?.email ?? null}, email), updated_at = now() where id = ${customerId}`;
}

route("GET", "/clients", async ({ req, url }) => {
  await avl(req);
  const q = url.searchParams.get("q")?.trim();
  const show = url.searchParams.get("show") ?? "active";
  const like = q ? `%${q}%` : null;
  const [rows, quotes] = await Promise.all([
    sql`select c.id, c.name, c.contact_name, c.email, c.phone, c.city, c.state, c.active, c.tax_exempt from ops.customers c
      where ${show === "all" ? sql`true` : show === "inactive" ? sql`not c.active` : sql`c.active`}
      ${like ? sql`and (c.name ilike ${like} or c.contact_name ilike ${like} or c.email ilike ${like} or c.city ilike ${like}
        or c.id in (select customer_id from ops.customer_contacts where name ilike ${like} or email ilike ${like}))` : sql``}
      order by c.name limit 500`,
    quotesWith(sql`true`, { limit: 5000 }),
  ]);
  return rows.map((c) => {
    const mine = quotes.filter((q) => q.customerId === c.id);
    const open = mine.filter((q) => ["DRAFT", "SENT", "CHANGES_REQUESTED"].includes(q.status));
    const won = mine.filter((q) => ["ACCEPTED", "CONVERTED"].includes(q.status));
    return {
      ...c, quotes: mine.length, openCents: open.reduce((s, q) => s + effectiveTotals(q).totalCents, 0),
      wonCents: won.reduce((s, q) => s + effectiveTotals(q).totalCents, 0),
      lastQuoteAt: mine.length ? new Date(Math.max(...mine.map((q) => new Date(q.updatedAt).getTime()))).toISOString() : null,
    };
  });
});

route("GET", "/clients/:id", async ({ req, params }) => {
  await avl(req);
  const [c] = await sql`select * from ops.customers where id = ${params.id}`;
  if (!c) throw new HttpError(404, "Client not found");
  const [contacts, quotes] = await Promise.all([
    sql`select id, name, title, email, phone, is_primary from ops.customer_contacts where customer_id = ${c.id} order by is_primary desc, name`,
    quotesWith(sql`q.customer_id = ${c.id}`, { limit: 500 }),
  ]);
  const { updatedAt: _u, ...client } = c;
  return {
    client, contacts, quotes: quotes.map(quoteRow),
    totals: {
      openCents: quotes.filter((q) => ["DRAFT", "SENT", "CHANGES_REQUESTED"].includes(q.status)).reduce((s, q) => s + effectiveTotals(q).totalCents, 0),
      wonCents: quotes.filter((q) => ["ACCEPTED", "CONVERTED"].includes(q.status)).reduce((s, q) => s + effectiveTotals(q).totalCents, 0),
    },
  };
});

route("POST", "/clients", async ({ req, body }) => {
  const u = await avl(req);
  const raw = await body();
  const data = ClientSchema.parse(raw);
  const contact = raw?.contact ? ContactSchema.parse({ ...raw.contact, isPrimary: true }) : null;
  const c = await sql.begin(async (tx) => {
    const [row] = await tx`insert into ops.customers ${tx({ ...data, contactName: contact?.name ?? null, email: contact?.email ?? data.email })} returning *`;
    if (contact) await tx`insert into ops.customer_contacts ${tx({ ...contact, customerId: row.id })}`;
    return row;
  });
  await logActivity({ actorId: u.id, action: "Added client", detail: c.name, area: "AVL", entityType: "Customer", entityId: c.id, href: `/avl/clients/view?id=${c.id}` });
  return { id: c.id, name: c.name, email: c.email, taxExempt: c.taxExempt };
});

route("PUT", "/clients/:id", async ({ req, params, body }) => {
  const u = await avl(req);
  const data = ClientSchema.parse(await body());
  const [c] = await sql`update ops.customers set ${sql({ ...data, updatedAt: new Date() })} where id = ${params.id} returning *`;
  if (!c) throw new HttpError(404, "Client not found");
  await logActivity({ actorId: u.id, action: "Updated client", detail: c.name, area: "AVL", entityType: "Customer", entityId: c.id, href: `/avl/clients/view?id=${c.id}` });
});

route("POST", "/clients/:id/contacts", async ({ req, params, body }) => {
  await avl(req);
  const data = ContactSchema.parse(await body());
  const [{ n }] = await sql`select count(*)::int as n from ops.customer_contacts where customer_id = ${params.id}`;
  if (data.isPrimary || n === 0) { data.isPrimary = true; await sql`update ops.customer_contacts set is_primary = false where customer_id = ${params.id}`; }
  const [ct] = await sql`insert into ops.customer_contacts ${sql({ ...data, customerId: params.id })} returning id`;
  await syncPrimary(params.id);
  return ct;
});
route("PUT", "/contacts/:id", async ({ req, params, body }) => {
  await avl(req);
  const data = ContactSchema.parse(await body());
  const [cur] = await sql`select customer_id from ops.customer_contacts where id = ${params.id}`;
  if (!cur) throw new HttpError(404, "Contact not found");
  if (data.isPrimary) await sql`update ops.customer_contacts set is_primary = false where customer_id = ${cur.customerId}`;
  await sql`update ops.customer_contacts set ${sql(data)} where id = ${params.id}`;
  await syncPrimary(cur.customerId);
});
route("DELETE", "/contacts/:id", async ({ req, params }) => {
  await avl(req);
  const [cur] = await sql`delete from ops.customer_contacts where id = ${params.id} returning customer_id`;
  if (cur) await syncPrimary(cur.customerId);
});

/* ───────────── AVL: people & business settings ───────────── */

route("GET", "/avl/people", async ({ req }) => {
  const me = await avlManager(req);
  const rows = await sql`select id, name, email, avl_level, synced_avl_level, ops_access, role, pending, active, last_login_at from ops.users
    where source <> 'PLATFORM' and (pending or avl_level <> 'NONE' or synced_avl_level in ('TECH','MANAGER') or role = 'ADMIN') order by pending desc, name`;
  const others = await sql`select id, name, email from ops.users where active and not pending and avl_level = 'NONE' and role <> 'ADMIN' and source <> 'PLATFORM' order by name`;
  return {
    people: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, avlLevel: effectiveAccess(r as never).avlLevel, opsAccess: r.opsAccess, role: r.role, pending: r.pending, active: r.active, lastLoginAt: r.lastLoginAt })),
    others, me: me.id,
  };
});

/** Give someone AVL access (or take it away). Approving a sign-up here makes them AVL-only. */
route("PUT", "/avl/people/:id", async ({ req, params, body }) => {
  const me = await avlManager(req);
  const { avlLevel, active } = z.object({ avlLevel: z.enum(["NONE", "TECH", "MANAGER"]), active: z.boolean().optional() }).parse(await body());
  const [u] = await sql`select * from ops.users where id = ${params.id}`;
  if (!u) throw new HttpError(404, "Person not found");
  if (u.id === me.id) throw new HttpError(403, "Someone else has to change your own access.");
  if (u.role === "ADMIN" && !isAdmin(me)) throw new HttpError(403, "Only a system admin can change another admin.");
  const patch: Record<string, unknown> = { avlLevel, updatedAt: new Date() };
  if (u.pending) {
    if (active === false) Object.assign(patch, { pending: false, active: false, deactivatedBy: "ADMIN" });
    else Object.assign(patch, { pending: false, active: true, opsAccess: false, approvedBy: me.id, approvedAt: new Date() });
  }
  await sql`update ops.users set ${sql(patch)} where id = ${u.id}`;
  await logActivity({
    actorId: me.id, area: "AVL", entityType: "User", entityId: u.id, href: "/avl/people",
    action: u.pending ? (active === false ? "Declined sign-up" : "Approved AVL sign-up") : "Changed AVL access",
    detail: `${u.name} · ${avlLevel === "NONE" ? "no AVL access" : `AVL ${avlLevel.toLowerCase()}`}`,
  });
});

const BusinessSchema = z.object({
  name: optStr(), legalName: optStr(), addressLine1: optStr(), addressLine2: optStr(), city: optStr(), state: optStr(), postalCode: optStr(),
  phone: optStr(), email: optStr(), website: optStr(), ein: optStr(), salesTaxId: optStr(),
  quotePrefix: z.string().max(10).nullish().transform((v) => v?.toUpperCase().replace(/[^A-Z0-9]/g, "") || "AV"),
  defaultTaxBps: z.number().int().min(0).max(5000), defaultDepositBps: z.number().int().min(0).max(10_000),
  defaultMarginBps: z.number().int().min(0).max(9900), laborRateCents: z.number().int().min(0).max(1_000_000_000),
  quoteValidDays: z.number().int().min(1).max(365), quoteTerms: optStr(20_000),
  businessType: z.enum(["INTEGRATOR", "CHURCH"]).default("INTEGRATOR"),
  jobPrefix: z.string().max(10).nullish().transform((v) => v?.toUpperCase().replace(/[^A-Z0-9]/g, "") || "J"),
});
route("GET", "/avl/business", async ({ req }) => {
  const me = await avl(req);
  const { id: _i, updatedAt: _u, ...business } = await getAvl();
  const [logo] = await sql`select mime, data_b64 from ops.org_assets where key = 'avl-logo'`;
  return { business, logo: dataUrl(logo), canEdit: isAvlManager(me) };
});
route("PUT", "/avl/business", async ({ req, body }) => {
  const me = await avlManager(req);
  const input = BusinessSchema.parse(await body());
  await getAvl();
  await sql`update ops.avl_business set ${sql({ ...input, updatedAt: new Date() })} where id = ${orgId()}`;
  await logActivity({ actorId: me.id, action: "Updated AVL business settings", area: "AVL", href: "/avl/settings" });
});
route("POST", "/avl/business/logo", async ({ req, body }) => {
  const me = await avlManager(req);
  needModule("branding", "Custom branding");
  const { mime, dataB64 } = z.object({ mime: z.enum(["image/png", "image/jpeg", "image/svg+xml", "image/webp"]), dataB64: z.string().min(1).max(1_400_000) }).parse(await body());
  await sql`insert into ops.org_assets ${sql({ key: "avl-logo", mime, dataB64, updatedAt: new Date() })}
    on conflict (org_id, key) do update set mime = excluded.mime, data_b64 = excluded.data_b64, updated_at = now()`;
  await logActivity({ actorId: me.id, action: "Updated AVL logo", area: "AVL", href: "/avl/settings" });
});
route("DELETE", "/avl/business/logo", async ({ req }) => {
  await avlManager(req);
  await sql`delete from ops.org_assets where key = 'avl-logo'`;
});

/* ───────────── Catalog & vendors ───────────── */

route("GET", "/catalog", async ({ req, url }) => {
  await avl(req);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const vendorId = url.searchParams.get("vendorId") || null;
  const take = Math.min(Number(url.searchParams.get("take") ?? 100) || 100, 300);
  const like = `%${q}%`;
  const [vendors, products] = await Promise.all([
    sql`select id, name from ops.vendors where active order by name`,
    sql`select p.id, p.sku, p.model, p.name, p.manufacturer, p.category, p.description, p.cost_cents, p.msrp_cents, p.map_cents, p.updated_at,
          json_build_object('id', v.id, 'name', v.name) as vendor
        from ops.products p join ops.vendors v on v.id = p.vendor_id
        where p.active ${vendorId ? sql`and p.vendor_id = ${vendorId}` : sql``}
          ${q ? sql`and (p.sku ilike ${like} or p.model ilike ${like} or p.name ilike ${like} or p.manufacturer ilike ${like})` : sql``}
        order by p.manufacturer nulls last, p.name limit ${take}`,
  ]);
  return { vendors, products };
});

const VendorSchema = z.object({
  name: z.string().min(1).max(200), accountNo: optStr(100), repName: optStr(), repEmail: z.string().email().nullish().or(z.literal("")).transform((v) => v || null),
  repPhone: optStr(50), website: optStr(300), terms: optStr(100), notes: optStr(10_000), active: z.boolean().optional(),
});
const vendorRows = (where: unknown) => sql`select v.*, (select count(*)::int from ops.products p where p.vendor_id = v.id) as product_count
  from ops.vendors v where ${where as never} order by v.name`;

route("GET", "/vendors", async ({ req }) => { await avl(req); return vendorRows(sql`true`); });
route("GET", "/vendors/:id", async ({ req, params }) => {
  await avl(req);
  const [v] = await vendorRows(sql`v.id = ${params.id}`);
  if (!v) throw new HttpError(404, "Vendor not found");
  const imports = await sql`select b.id, b.file_name, b.status, b.created, b.updated, b.skipped, b.created_at, u.name as uploaded_by
    from ops.import_batches b join ops.users u on u.id = b.uploaded_by_id where b.vendor_id = ${params.id} order by b.created_at desc limit 10`;
  return { vendor: v, imports };
});
route("POST", "/vendors", async ({ req, body }) => {
  const u = await avl(req);
  const data = VendorSchema.parse(await body());
  const [v] = await sql`insert into ops.vendors ${sql(defined(data))} returning *`;
  await logActivity({ actorId: u.id, action: "Created vendor", detail: v.name, area: "AVL", entityType: "Vendor", entityId: v.id, href: `/avl/vendors/view?id=${v.id}` });
  return v;
});
route("PUT", "/vendors/:id", async ({ req, params, body }) => {
  await avl(req);
  const data = VendorSchema.partial().parse(await body());
  const [v] = await sql`update ops.vendors set ${sql({ ...defined(data), updatedAt: new Date() })} where id = ${params.id} returning *`;
  if (!v) throw new HttpError(404, "Vendor not found");
  return v;
});

/** One product by hand (no spreadsheet). Same SKU at the same vendor = that product. */
const ProductSchema = z.object({
  sku: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(300), model: optStr(120), manufacturer: optStr(120), category: optStr(120),
  description: optStr(5000), costCents: cents, msrpCents: cents.nullish().transform((v) => v ?? null), mapCents: cents.nullish().transform((v) => v ?? null),
});
route("POST", "/vendors/:id/products", async ({ req, params, body }) => {
  const u = await avl(req);
  const data = ProductSchema.parse(await body());
  const [vendor] = await sql`select id, name from ops.vendors where id = ${params.id}`;
  if (!vendor) throw new HttpError(404, "Vendor not found");
  const [dupe] = await sql`select active from ops.products where vendor_id = ${vendor.id} and sku = ${data.sku}`;
  if (dupe?.active) throw new HttpError(409, `${vendor.name} already has a product with SKU ${data.sku}.`);
  const [p] = await sql`insert into ops.products ${sql({ ...data, vendorId: vendor.id, active: true, updatedAt: new Date() })}
    on conflict (vendor_id, sku) do update set name = excluded.name, model = excluded.model, manufacturer = excluded.manufacturer, category = excluded.category,
      description = excluded.description, cost_cents = excluded.cost_cents, msrp_cents = excluded.msrp_cents, map_cents = excluded.map_cents, active = true, updated_at = now()
    returning id`;
  await logActivity({ actorId: u.id, action: "Added product", detail: `${vendor.name} · ${data.sku} · ${data.name}`, area: "AVL", entityType: "Product", entityId: p.id, href: `/avl/catalog?vendorId=${vendor.id}&q=${encodeURIComponent(data.sku)}` });
  return { id: p.id };
});
route("PUT", "/products/:id", async ({ req, params, body }) => {
  const u = await avl(req);
  const data = ProductSchema.parse(await body());
  const [cur] = await sql`select vendor_id, sku from ops.products where id = ${params.id}`;
  if (!cur) throw new HttpError(404, "Product not found");
  if (data.sku !== cur.sku && (await sql`select 1 from ops.products where vendor_id = ${cur.vendorId} and sku = ${data.sku} and id <> ${params.id}`).length) {
    throw new HttpError(409, `This vendor already has a product with SKU ${data.sku}.`);
  }
  await sql`update ops.products set ${sql({ ...data, updatedAt: new Date() })} where id = ${params.id}`;
  await logActivity({ actorId: u.id, action: "Updated product", detail: `${data.sku} · ${data.name}`, area: "AVL", entityType: "Product", entityId: params.id });
});
/** Removed from pricing (quotes that used it keep their own copy of the line). */
route("DELETE", "/products/:id", async ({ req, params }) => {
  const u = await avl(req);
  const [p] = await sql`update ops.products set active = false, updated_at = now() where id = ${params.id} returning sku, name`;
  if (p) await logActivity({ actorId: u.id, action: "Removed product", detail: `${p.sku} · ${p.name}`, area: "AVL", entityType: "Product", entityId: params.id });
});

/**
 * Price list import. Sundays reads the CSV / Excel file and maps the columns; this gets the
 * normalized rows. commit=false is the dry run (how many new / updated).
 */
route("POST", "/vendors/:id/import", async ({ req, params, body }) => {
  const u = await avl(req);
  const input = z.object({
    fileName: z.string().min(1).max(300), rowCount: z.number().int().min(0), commit: z.boolean().default(false),
    errors: z.array(z.object({ row: z.number().int(), message: z.string().max(300) })).max(5000).default([]),
    products: z.array(z.object({
      sku: z.string().min(1).max(120), model: optStr(120), name: z.string().min(1).max(300), manufacturer: optStr(120), category: optStr(120),
      description: optStr(5000), costCents: cents, msrpCents: cents.nullish().transform((v) => v ?? null), mapCents: cents.nullish().transform((v) => v ?? null),
    })).max(20_000),
  }).parse(await body());
  const [vendor] = await sql`select * from ops.vendors where id = ${params.id}`;
  if (!vendor) throw new HttpError(404, "Vendor not found");
  const skus = input.products.map((p) => p.sku);
  const existing = new Set((skus.length ? await sql`select sku from ops.products where vendor_id = ${vendor.id} and sku = any(${skus})` : []).map((p) => p.sku as string));
  const toCreate = input.products.filter((p) => !existing.has(p.sku)).length;
  const toUpdate = input.products.length - toCreate;
  if (!input.commit) return { toCreate, toUpdate };

  const batch = await sql.begin(async (tx) => {
    const [b] = await tx`insert into ops.import_batches ${tx({ vendorId: vendor.id, uploadedById: u.id, fileName: input.fileName, rowCount: input.rowCount })} returning *`;
    for (let i = 0; i < input.products.length; i += 500) {
      const chunk = input.products.slice(i, i + 500).map((p) => ({ ...p, vendorId: vendor.id, lastImportId: b.id, active: true, updatedAt: new Date() }));
      await tx`insert into ops.products ${tx(chunk)}
        on conflict (vendor_id, sku) do update set model = excluded.model, name = excluded.name, manufacturer = excluded.manufacturer,
          category = excluded.category, description = excluded.description, cost_cents = excluded.cost_cents, msrp_cents = excluded.msrp_cents,
          map_cents = excluded.map_cents, active = true, last_import_id = excluded.last_import_id, updated_at = now()`;
    }
    const [done] = await tx`update ops.import_batches set ${tx({ status: "COMMITTED", created: toCreate, updated: toUpdate, skipped: input.errors.length, errors: input.errors.slice(0, 500) })} where id = ${b.id} returning *`;
    return done;
  });
  await logActivity({ actorId: u.id, action: "Imported price list", detail: `${vendor.name} · ${input.fileName} · +${toCreate} / ~${toUpdate}`, area: "AVL", entityType: "Vendor", entityId: vendor.id, href: `/avl/vendors/view?id=${vendor.id}` });
  return { committed: true, batch };
});

/* ───────────── Settings: users ───────────── */

const UserSchema = z.object({
  name: z.string().min(1).max(200), email: z.string().email().transform((e) => e.toLowerCase()),
  title: optStr(), department: optStr(), phone: optStr(50), campusId: id.nullish().transform((v) => v ?? null),
  allCampuses: z.boolean().default(false), role: z.enum(["STAFF", "MANAGER", "EXECUTIVE", "ADMIN"]).default("STAFF"),
  avlLevel: z.enum(["NONE", "TECH", "MANAGER"]).default("NONE"), opsAccess: z.boolean().default(true),
  checkinLevel: z.enum(["NONE", "VIEW", "CHECKIN", "MANAGER"]).default("NONE"),
  teamIds: z.array(id).default([]), active: z.boolean().default(true),
});
/** Only AVL Managers and admins hand out AVL access; everyone else keeps what's there. */
const keepAvl = (actor: U, data: { avlLevel: "NONE" | "TECH" | "MANAGER" }, existing: "NONE" | "TECH" | "MANAGER") => {
  if (!isAvlManager(actor)) data.avlLevel = existing;
};

async function assertTeamsInScope(actor: U, teamIds: string[]) {
  if (!teamIds.length || seesAllCampuses(actor)) return;
  const teams = await sql`select name, campus_id from ops.teams where id = any(${teamIds})`;
  const bad = teams.find((t) => !canManageCampus(actor, t.campusId));
  if (bad) throw new HttpError(403, `You can't manage membership of "${bad.name}".`);
}

async function userRows(me: U, where: unknown): Promise<UserRow[]> {
  const rows = await sql`select u.*, c.name as campus_name,
      coalesce((select json_agg(json_build_object('id', t.id, 'name', t.name, 'synced', m.synced) order by t.name)
        from ops.team_members m join ops.teams t on t.id = m.team_id where m.user_id = u.id), '[]') as teams
    from ops.users u left join ops.campuses c on c.id = u.campus_id where u.source <> 'PLATFORM' and ${where as never} order by u.pending desc, u.name limit 500`;
  return rows.map((u) => {
    const a = effectiveAccess(u as never);
    return {
      id: u.id, email: u.email, name: u.name, title: u.title, department: u.department, phone: u.phone, active: u.active, pending: u.pending,
      registered: u.registered, campusId: u.campusId, campusName: u.campusName, allCampuses: u.allCampuses, role: u.role, avlLevel: u.avlLevel, opsAccess: u.opsAccess,
      checkinLevel: u.checkinLevel ?? "NONE", effectiveCheckin: checkinLevelFor(u as never),
      effectiveRole: a.role, effectiveAvl: a.avlLevel, global: a.global, source: u.source, teams: u.teams, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
      // A pending sign-up at no campus can be approved by any manager (they choose the campus).
      editable: canEditUser(me, { id: u.id, role: a.role, allCampuses: u.allCampuses, campusId: u.campusId }) || (u.pending && !u.campusId && atLeast(me, "MANAGER")),
    };
  });
}

route("GET", "/settings/users", async ({ req, url }) => {
  const me = await manager(req);
  const global = seesAllCampuses(me);
  const q = url.searchParams.get("q")?.trim();
  const campus = url.searchParams.get("campus");
  const role = url.searchParams.get("role");
  const status = url.searchParams.get("status") ?? "active";
  const like = q ? `%${q}%` : null;
  const where = sql`true
    ${like ? sql`and (u.name ilike ${like} or u.email ilike ${like} or u.department ilike ${like})` : sql``}
    ${global ? (campus ? (campus === "ALL" ? sql`and u.all_campuses` : sql`and u.campus_id = ${campus}`) : sql``)
      : sql`and (u.campus_id = ${me.campusId ?? "__none__"} ${status === "pending" ? sql`or u.campus_id is null` : sql``})`}
    ${role ? sql`and (u.role = ${role} or u.synced_role = ${role})` : sql``}
    ${status === "pending" ? sql`and u.pending` : status === "inactive" ? sql`and not u.active and not u.pending` : sql`and u.active`}
    ${status === "pending" ? sql`` : status === "avl" ? sql`and not u.ops_access` : sql`and u.ops_access`}`;
  const [users, campuses, teams, [{ n: pending }]] = await Promise.all([
    userRows(me, where),
    sql`select id, name from ops.campuses where active order by sort_order, name`,
    sql`select id, name, campus_id from ops.teams where active order by name`,
    sql`select count(*)::int as n from ops.users u where u.pending and u.source <> 'PLATFORM' ${global ? sql`` : sql`and (u.campus_id = ${me.campusId ?? "__none__"} or u.campus_id is null)`}`,
  ]);
  return {
    users, campuses, pending, global, grantableRoles: grantableRoles(me), myCampusId: me.campusId, grantsAvl: isAvlManager(me),
    teams: teams.filter((t) => canManageCampus(me, t.campusId)).map((t) => ({ id: t.id, name: t.name })),
  };
});

route("GET", "/settings/users/:id", async ({ req, params }) => {
  const me = await manager(req);
  const [u] = await userRows(me, sql`u.id = ${params.id}`);
  if (!u || !u.editable) throw new HttpError(404, "User not found");
  const [campuses, teams] = await Promise.all([
    sql`select id, name from ops.campuses where active order by sort_order, name`,
    sql`select t.id, t.name, t.campus_id, c.name as campus_name from ops.teams t left join ops.campuses c on c.id = t.campus_id where t.active order by t.name`,
  ]);
  return {
    user: u, campuses, self: me.id === u.id, global: seesAllCampuses(me), grantableRoles: me.id === u.id ? [] : grantableRoles(me), grantsAvl: isAvlManager(me),
    teams: teams.map((t) => ({ id: t.id, name: t.name, campusName: t.campusName, manageable: canManageCampus(me, t.campusId) })),
  };
});

route("POST", "/settings/users", async ({ req, body }) => {
  const actor = await manager(req);
  const { teamIds, ...data } = UserSchema.parse(await body());
  if (!seesAllCampuses(actor)) data.campusId = actor.campusId;
  keepAvl(actor, data, "NONE");
  const err = checkUserGrant(actor, data);
  if (err) throw new HttpError(403, err);
  await assertTeamsInScope(actor, teamIds);
  const [dupe] = await sql`select 1 from ops.users where email = ${data.email}`;
  if (dupe) throw new HttpError(409, "A user with that email already exists.");
  // Added by a manager = approved. When they register with this email, they're straight in.
  const u = await sql.begin(async (tx) => {
    const [row] = await tx`insert into ops.users ${tx({ ...data, pending: false, approvedBy: actor.id, approvedAt: new Date() })} returning *`;
    for (const t of teamIds) await tx`insert into ops.team_members ${tx({ teamId: t, userId: row.id })}`;
    return row;
  });
  await logActivity({ actorId: actor.id, action: "Created user", detail: `${u.name} · ${roleLabel(u.role)}`, area: "ADMIN", entityType: "User", entityId: u.id, href: `/ops/settings/users/view?id=${u.id}`, campusId: u.campusId });
  return { id: u.id };
});

route("PUT", "/settings/users/:id", async ({ req, params, body }) => {
  const actor = await manager(req);
  const [existing] = await sql`select * from ops.users where id = ${params.id}`;
  if (!existing) throw new HttpError(404, "User not found");
  const current = effectiveAccess(existing as never);
  const approving = existing.pending;
  if (!canEditUser(actor, { id: existing.id, role: current.role, allCampuses: existing.allCampuses, campusId: existing.campusId })
      && !(approving && !existing.campusId)) throw new HttpError(403, "You can't edit this user.");
  const { teamIds, ...data } = UserSchema.parse(await body());
  if (!seesAllCampuses(actor)) { data.campusId = actor.campusId; data.allCampuses = false; }
  keepAvl(actor, data, existing.avlLevel);
  if (existing.id === actor.id) {
    // Your own role, scope and status are changed by someone else.
    data.role = existing.role; data.allCampuses = existing.allCampuses; data.active = true; data.opsAccess = existing.opsAccess; data.avlLevel = existing.avlLevel;
    data.checkinLevel = existing.checkinLevel;
  } else {
    const err = checkUserGrant(actor, data);
    if (err) throw new HttpError(403, err);
  }
  if (existing.source !== "MANUAL") { data.email = existing.email; data.name = existing.name; }
  else if (data.email !== existing.email) {
    if (existing.registered) data.email = existing.email; // their sign-in email
    else if ((await sql`select 1 from ops.users where email = ${data.email}`).length) throw new HttpError(409, "Another user already has that email.");
  }
  await assertTeamsInScope(actor, teamIds);
  const memberships = await sql`select m.team_id, m.synced, t.campus_id from ops.team_members m join ops.teams t on t.id = m.team_id where m.user_id = ${existing.id}`;
  const removable = memberships.filter((m) => !m.synced && canManageCampus(actor, m.campusId) && !teamIds.includes(m.teamId)).map((m) => m.teamId as string);
  await sql.begin(async (tx) => {
    await tx`update ops.users set ${tx({
      ...data, updatedAt: new Date(), pending: false,
      deactivatedBy: data.active ? null : existing.active ? "ADMIN" : existing.deactivatedBy,
      ...(approving && data.active ? { approvedBy: actor.id, approvedAt: new Date() } : {}),
    })} where id = ${existing.id}`;
    if (removable.length) await tx`delete from ops.team_members where user_id = ${existing.id} and team_id = any(${removable})`;
    for (const t of teamIds) await tx`insert into ops.team_members ${tx({ teamId: t, userId: existing.id })} on conflict do nothing`;
  });
  await logActivity({
    actorId: actor.id, action: approving ? (data.active ? "Approved user" : "Declined sign-up") : "Updated user",
    detail: `${data.name} · ${roleLabel(data.role)}${data.avlLevel !== "NONE" ? ` + AVL ${data.avlLevel.toLowerCase()}` : ""}`,
    area: "ADMIN", entityType: "User", entityId: existing.id, href: `/ops/settings/users/view?id=${existing.id}`, campusId: data.campusId,
  });
});

/* ───────────── Settings: teams ───────────── */

const TeamSchema = z.object({
  name: z.string().min(1).max(100), description: optStr(500), campusId: id.nullish().transform((v) => v ?? null),
  email: z.string().email().nullish().or(z.literal("")).transform((v) => v || null), active: z.boolean().default(true),
});

route("GET", "/settings/teams", async ({ req }) => {
  const me = await manager(req);
  const global = seesAllCampuses(me);
  const [teams, campuses] = await Promise.all([
    sql`select t.*, c.name as campus_name,
        (select count(*)::int from ops.team_members m where m.team_id = t.id) as members,
        (select count(*)::int from ops.category_routings r where r.handler_team_id = t.id) as handles,
        (select count(*)::int from ops.category_routings r where r.approver_team_id = t.id) as approves
      from ops.teams t left join ops.campuses c on c.id = t.campus_id
      where ${global ? sql`true` : sql`(t.campus_id = ${me.campusId ?? "__none__"} or t.campus_id is null)`} order by t.name`,
    sql`select id, name from ops.campuses where active order by sort_order, name`,
  ]);
  return { teams: teams.map((t) => ({ ...t, manageable: canManageCampus(me, t.campusId) })), campuses, global, myCampusId: me.campusId };
});

route("GET", "/settings/teams/:id", async ({ req, params }) => {
  const me = await manager(req);
  const [team] = await sql`select t.*, c.name as campus_name from ops.teams t left join ops.campuses c on c.id = t.campus_id where t.id = ${params.id}`;
  if (!team || !canManageCampus(me, team.campusId)) throw new HttpError(404, "Team not found");
  const global = seesAllCampuses(me);
  const [members, routing, campuses, users] = await Promise.all([
    sql`select u.id, u.name, u.email, u.active, m.is_lead, m.synced from ops.team_members m join ops.users u on u.id = m.user_id where m.team_id = ${team.id} order by u.name`,
    sql`select r.id, c.name as category, c.icon, ca.name as campus, (r.handler_team_id = ${team.id}) as handles
      from ops.category_routings r join ops.request_categories c on c.id = r.category_id left join ops.campuses ca on ca.id = r.campus_id
      where r.handler_team_id = ${team.id} or r.approver_team_id = ${team.id} order by c.name`,
    sql`select id, name from ops.campuses where active order by sort_order, name`,
    sql`select id, name from ops.users where active and ops_access and source <> 'PLATFORM' and id not in (select user_id from ops.team_members where team_id = ${team.id})
      ${global ? sql`` : sql`and campus_id = ${me.campusId ?? "__none__"} and not all_campuses`} order by name`,
  ]);
  return { team, members, routing, campuses, users, global };
});

route("POST", "/settings/teams", async ({ req, body }) => {
  const me = await manager(req);
  const data = TeamSchema.parse(await body());
  if (!seesAllCampuses(me)) data.campusId = me.campusId;
  if (!canManageCampus(me, data.campusId)) throw new HttpError(403, "You can only create teams for your campus.");
  const [t] = await sql`insert into ops.teams ${sql(data)} returning *`;
  await logActivity({ actorId: me.id, action: "Created team", detail: t.name, area: "ADMIN", entityType: "Team", entityId: t.id, href: `/ops/settings/teams/view?id=${t.id}` });
  return { id: t.id };
});

route("PUT", "/settings/teams/:id", async ({ req, params, body }) => {
  const me = await manager(req);
  const [team] = await sql`select * from ops.teams where id = ${params.id}`;
  if (!team || !canManageCampus(me, team.campusId)) throw new HttpError(403, "You can only manage teams at your campus.");
  const data = TeamSchema.parse(await body());
  if (!seesAllCampuses(me)) data.campusId = me.campusId;
  await sql`update ops.teams set ${sql(data)} where id = ${params.id}`;
});

async function teamGuard(me: U, teamId: string) {
  const [team] = await sql`select * from ops.teams where id = ${teamId}`;
  if (!team || !canManageCampus(me, team.campusId)) throw new HttpError(403, "You can only manage teams at your campus.");
}
route("POST", "/settings/teams/:id/members", async ({ req, params, body }) => {
  const me = await manager(req);
  await teamGuard(me, params.id);
  const { userId, isLead } = z.object({ userId: id, isLead: z.boolean().default(false) }).parse(await body());
  const [target] = await sql`select * from ops.users where id = ${userId}`;
  if (!target) throw new HttpError(404, "User not found");
  if (!seesAllCampuses(me) && (target.allCampuses || !canAccessCampus(me, target.campusId))) throw new HttpError(403, "You can only add people from your campus.");
  await sql`insert into ops.team_members ${sql({ teamId: params.id, userId, isLead })}
    on conflict (team_id, user_id) do update set is_lead = excluded.is_lead, synced = false`;
});
route("DELETE", "/settings/teams/:id/members/:userId", async ({ req, params }) => {
  const me = await manager(req);
  await teamGuard(me, params.id);
  await sql`delete from ops.team_members where team_id = ${params.id} and user_id = ${params.userId}`;
});

/* ───────────── Settings: request types ───────────── */

const CategorySchema = z.object({
  name: z.string().min(1).max(100), kind: z.enum(["TECHNOLOGY", "SUPPLY", "MAINTENANCE", "OTHER"]), workflow: z.enum(["APPROVAL", "FULFILLMENT", "WORK_ORDER"]),
  description: optStr(300), icon: optStr(8), approvalThresholdCents: z.number().int().min(0).nullish().transform((v) => v ?? null),
  requiresLocation: z.boolean().default(false), allowLineItems: z.boolean().default(false),
  sortOrder: z.number().int().nullish().transform((v) => v ?? 0), active: z.boolean().default(true),
});
const SupplyItemSchema = z.object({
  name: z.string().min(1).max(200), unit: z.string().min(1).max(30).default("each"), sku: optStr(100),
  unitCostCents: z.number().int().min(0).nullish().transform((v) => v ?? null), sortOrder: z.number().int().nullish().transform((v) => v ?? 0), active: z.boolean().default(true),
});

/** A request type, checked against the organization's modules. */
function categoryInput(body: unknown) {
  const data = CategorySchema.parse(body);
  if (!kindAllowed(data.kind, reqCtx()!.modules)) throw new HttpError(403, "That kind of request isn't part of this organization's plan.");
  if (!hasModule("supplies")) data.allowLineItems = false;
  return data;
}
route("GET", "/settings/request-types", async ({ req }) => {
  const me = await manager(req);
  const [cats, [{ n: campusCount }]] = await Promise.all([
    sql`select c.*,
        (select count(*)::int from ops.supply_items s where s.category_id = c.id) as supply_item_count,
        (select count(*)::int from ops.requests r where r.category_id = c.id) as request_count,
        coalesce((select json_agg(json_build_object('campusId', r.campus_id, 'handlerTeam', h.name, 'approverTeam', a.name))
          from ops.category_routings r join ops.teams h on h.id = r.handler_team_id left join ops.teams a on a.id = r.approver_team_id
          where r.category_id = c.id), '[]') as routing
      from ops.request_categories c order by c.kind, c.sort_order, c.name`,
    sql`select count(*)::int as n from ops.campuses where active`,
  ]);
  const mods = reqCtx()!.modules;
  return {
    categories: cats.filter((c) => kindAllowed(c.kind, mods)), campusCount: hasModule("campuses") ? campusCount : Math.min(campusCount, 1),
    global: isGlobalManager(me), modules: mods,
  };
});

route("GET", "/settings/request-types/:id", async ({ req, params }) => {
  const me = await manager(req);
  const global = isGlobalManager(me);
  const [cat] = await sql`select * from ops.request_categories where id = ${params.id}`;
  if (!cat) throw new HttpError(404, "Request type not found");
  const [routings, items, campuses, teams] = await Promise.all([
    sql`select campus_id, handler_team_id, approver_team_id from ops.category_routings where category_id = ${cat.id}`,
    sql`select * from ops.supply_items where category_id = ${cat.id} order by sort_order, name`,
    sql`select id, name from ops.campuses where active order by sort_order, name`,
    sql`select t.id, t.name, t.campus_id from ops.teams t where t.active
      ${global ? sql`` : sql`and (t.campus_id = ${me.campusId ?? "__none__"} or t.campus_id is null)`} order by t.name`,
  ]);
  const rows = !hasModule("campuses")
    ? [{ key: "ALL", label: "Everyone", campusId: null }]
    : global
    ? [...campuses.map((c) => ({ key: c.id, label: c.name, campusId: c.id })), { key: "ALL", label: "All other campuses (fallback)", campusId: null }]
    : campuses.filter((c) => canManageCampus(me, c.id)).map((c) => ({ key: c.id, label: c.name, campusId: c.id }));
  return { category: cat, routings, supplyItems: items, rows, teams, global, hasFallback: routings.some((r) => !r.campusId) };
});

route("POST", "/settings/request-types", async ({ req, body }) => {
  const me = await manager(req);
  globalOnly(me, "change request types");
  const data = categoryInput(await body());
  const [c] = await sql`insert into ops.request_categories ${sql(data)} returning *`;
  await logActivity({ actorId: me.id, action: "Created request type", detail: c.name, area: "ADMIN", entityType: "RequestCategory", entityId: c.id, href: `/ops/settings/request-types/view?id=${c.id}` });
  return { id: c.id };
});
route("PUT", "/settings/request-types/:id", async ({ req, params, body }) => {
  const me = await manager(req);
  globalOnly(me, "change request types");
  await sql`update ops.request_categories set ${sql(categoryInput(await body()))} where id = ${params.id}`;
});
route("POST", "/settings/request-types/:id/items", async ({ req, params, body }) => {
  const me = await manager(req);
  globalOnly(me, "change request types");
  const [i] = await sql`insert into ops.supply_items ${sql({ ...SupplyItemSchema.parse(await body()), categoryId: params.id })} returning *`;
  return i;
});
route("PUT", "/settings/supply-items/:id", async ({ req, params, body }) => {
  const me = await manager(req);
  globalOnly(me, "change request types");
  await sql`update ops.supply_items set ${sql(SupplyItemSchema.parse(await body()))} where id = ${params.id}`;
});

/**
 * Routing: { rows: [{ campusId | null, handlerTeamId | null, approverTeamId | null }] }.
 * Global managers replace every route; campus managers only their own campus's row, and only with
 * teams at their campus or all-campus teams.
 */
route("PUT", "/settings/request-types/:id/routes", async ({ req, params, body }) => {
  const me = await manager(req);
  const { rows } = z.object({ rows: z.array(z.object({ campusId: z.string().nullable(), handlerTeamId: z.string().nullable(), approverTeamId: z.string().nullable() })).max(200) }).parse(await body());
  if (isGlobalManager(me)) {
    await sql.begin(async (tx) => {
      await tx`delete from ops.category_routings where category_id = ${params.id}`;
      const valid = rows.filter((r) => r.handlerTeamId);
      if (valid.length) await tx`insert into ops.category_routings ${tx(valid.map((r) => ({ ...r, categoryId: params.id })))}`;
    });
  } else {
    const mine = rows.filter((r) => r.campusId && canManageCampus(me, r.campusId));
    if (!mine.length) throw new HttpError(403, "You can only change routing for your campus.");
    const teamIds = mine.flatMap((r) => [r.handlerTeamId, r.approverTeamId]).filter((t): t is string => !!t);
    const teams = teamIds.length ? await sql`select campus_id from ops.teams where id = any(${teamIds})` : [];
    if (teams.some((t) => t.campusId && !canManageCampus(me, t.campusId))) throw new HttpError(403, "Pick a team from your campus or an all-campus team.");
    await sql.begin(async (tx) => {
      for (const r of mine) {
        await tx`delete from ops.category_routings where category_id = ${params.id} and campus_id = ${r.campusId}`;
        if (r.handlerTeamId) await tx`insert into ops.category_routings ${tx({ ...r, categoryId: params.id })}`;
      }
    });
  }
  await logActivity({ actorId: me.id, action: "Updated routing", area: "ADMIN", entityType: "RequestCategory", entityId: params.id, href: `/ops/settings/request-types/view?id=${params.id}`, campusId: isGlobalManager(me) ? null : me.campusId });
});

/* ───────────── Settings: campuses ───────────── */

const CampusSchema = z.object({
  name: z.string().min(1).max(100), code: z.string().min(1).max(10).transform((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, "")),
  addressLine1: optStr(), city: optStr(), state: optStr(20), postalCode: optStr(20), phone: optStr(50),
  sortOrder: z.number().int().nullish().transform((v) => v ?? 0), active: z.boolean().default(true),
});

route("GET", "/settings/campuses", async ({ req }) => {
  const me = await manager(req);
  const global = isGlobalManager(me);
  const campuses = await sql`select c.*,
      (select count(*)::int from ops.users u where u.campus_id = c.id) as users,
      (select count(*)::int from ops.teams t where t.campus_id = c.id) as teams,
      (select count(*)::int from ops.requests r where r.campus_id = c.id) as requests
    from ops.campuses c where ${global ? sql`true` : sql`c.id = ${me.campusId ?? "__none__"}`} order by c.sort_order, c.name`;
  return { campuses, global };
});
route("POST", "/settings/campuses", async ({ req, body }) => {
  const me = await manager(req);
  globalOnly(me, "add campuses");
  const [{ n }] = await sql`select count(*)::int as n from ops.campuses`;
  if (n > 0) needModule("campuses", "More than one campus");
  const [c] = await sql`insert into ops.campuses ${sql(CampusSchema.parse(await body()))} returning *`;
  await logActivity({ actorId: me.id, action: "Added campus", detail: c.name, area: "ADMIN", entityType: "Campus", entityId: c.id, href: "/ops/settings/campuses" });
  return { id: c.id };
});
route("PUT", "/settings/campuses/:id", async ({ req, params, body }) => {
  const me = await manager(req);
  if (!canManageCampus(me, params.id)) throw new HttpError(403, "You can only edit your own campus.");
  const data = CampusSchema.parse(await body());
  if (!isGlobalManager(me)) {
    const [cur] = await sql`select active, code from ops.campuses where id = ${params.id}`;
    data.active = cur.active; // only global managers can deactivate a campus
    data.code = cur.code;
  }
  const [c] = await sql`update ops.campuses set ${sql({ ...data, updatedAt: new Date() })} where id = ${params.id} returning *`;
  await logActivity({ actorId: me.id, action: "Updated campus", detail: c.name, area: "ADMIN", entityType: "Campus", entityId: c.id, href: "/ops/settings/campuses" });
});

/* ───────────── Settings: activity ───────────── */

route("GET", "/settings/activity", async ({ req, url }) => {
  const me = await manager(req);
  const area = ["AUTH", "REQUESTS", "AVL", "ADMIN", "SYNC"].find((a) => a === url.searchParams.get("area"));
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1") || 1);
  const PER = 100;
  const where = sql`${seesAllCampuses(me) ? sql`true` : sql`a.campus_id = ${me.campusId ?? "__none__"}`} ${area ? sql`and a.area = ${area}` : sql``}`;
  const [rows, [{ n: total }]] = await Promise.all([
    sql`select a.id, a.actor_label, a.action, a.detail, a.area, a.href, a.created_at, x.name as actor_name
      from ops.activity_log a left join ops.users x on x.id = a.actor_id where ${where} order by a.created_at desc offset ${(page - 1) * PER} limit ${PER}`,
    sql`select count(*)::int as n from ops.activity_log a where ${where}`,
  ]);
  return { rows, total, page, per: PER };
});

/* ───────────── Settings: organization ───────────── */

/* ───────────── Settings: team check-ins (the website at sundays-checkin.vercel.app) ───────────── */

/** Someone who manages check-ins (System admins always do). */
async function checkinManager(req: Request) {
  const me = await requireUser(req);
  const [row] = await sql`select role, synced_role, checkin_level from ops.users where id = ${me.id}`;
  if (!me.platform && (!row || CHECKIN_RANK[checkinLevelFor(row as never)] < CHECKIN_RANK.MANAGER)) throw new HttpError(403, "Only people who manage check-ins can do that.");
  return me;
}
route("GET", "/settings/checkin", async ({ req }) => {
  await checkinManager(req);
  const o = await getOrg();
  const [cfg, levels] = await Promise.all([
    checkinSettings(),
    sql`select role, synced_role, checkin_level from ops.users where active and source <> 'PLATFORM'`,
  ]);
  const people: Record<string, number> = {};
  for (const u of levels) { const l = checkinLevelFor(u as never); people[l] = (people[l] ?? 0) + 1; }
  return {
    linked: o.pcoOrgId ? { pcoOrgId: o.pcoOrgId, pcoOrgName: o.pcoOrgName } : null,
    configured: { events: Object.keys(cfg.events).length, teamLocations: Object.keys(cfg.teamLocations).length, groups: cfg.groups.length },
    people,
  };
});
/** Disconnect Planning Center: everyone signed in to check-ins is signed out. */
route("DELETE", "/settings/checkin/link", async ({ req }) => {
  const me = await admin(req);
  await raw`update ops.organization set pco_org_id = null, pco_org_name = null, updated_at = now() where id = ${orgId()}`;
  await raw`delete from ops.checkin_sessions where org_id = ${orgId()}`;
  await logActivity({ actorId: me.id, action: "Disconnected Planning Center", detail: "Team check-ins", area: "ADMIN", href: "/ops/settings/organization" });
});
/** The Mac's check-in settings (Preferences → Team Check-ins and its ministries), copied up once. */
route("PUT", "/settings/checkin/import", async ({ req, body }) => {
  const me = await checkinManager(req);
  const { replace, ...cfg } = ConfigSchema.extend({ replace: z.boolean().default(false) }).parse(await body());
  const cur = await checkinSettings();
  const has = Object.keys(cur.events).length + Object.keys(cur.teamLocations).length + cur.groups.length > 0;
  if (has && !replace) throw new HttpError(409, "The website already has check-in settings.", { status: "exists" });
  const saved = await saveCheckinSettings(cfg, me.name);
  await logActivity({ actorId: me.id, action: "Copied check-in settings from the Mac", detail: `${Object.keys(cfg.events).length} service types, ${cfg.groups.length} ministries`, area: "ADMIN" });
  return saved;
});

route("GET", "/settings/organization", async ({ req }) => {
  await admin(req);
  const { id: _i, updatedAt: _u, ...org } = await getOrg();
  const b = await brand();
  const [dark] = await sql`select 1 from ops.org_assets where key = 'logo-dark'`;
  return { org, logo: b.logo, logoDark: dark ? b.logoDark : null };
});
route("PUT", "/settings/organization", async ({ req, body }) => {
  const me = await admin(req);
  const input = z.object({
    name: optStr(), legalName: optStr(), addressLine1: optStr(), addressLine2: optStr(), city: optStr(), state: optStr(), postalCode: optStr(),
    phone: optStr(), email: optStr(), website: optStr(), ein: optStr(), salesTaxId: optStr(),
    quotePrefix: z.string().max(10).nullish().transform((v) => v?.toUpperCase().replace(/[^A-Z0-9]/g, "") || "CC"),
    taxExempt: z.boolean().optional(),
  }).parse(await body());
  await getOrg();
  await sql`update ops.organization set ${sql({ ...defined(input), updatedAt: new Date() })} where id = ${orgId()}`;
  await logActivity({ actorId: me.id, action: "Updated organization settings", area: "ADMIN", href: "/ops/settings/organization" });
});
route("POST", "/settings/organization/logo", async ({ req, body }) => {
  const me = await admin(req);
  needModule("branding", "Custom branding");
  const { variant, mime, dataB64 } = z.object({
    variant: z.enum(["light", "dark"]), mime: z.enum(["image/png", "image/jpeg", "image/svg+xml", "image/webp"]), dataB64: z.string().min(1).max(1_400_000),
  }).parse(await body());
  const key = variant === "dark" ? "logo-dark" : "logo";
  await sql`insert into ops.org_assets ${sql({ key, mime, dataB64, updatedAt: new Date() })}
    on conflict (org_id, key) do update set mime = excluded.mime, data_b64 = excluded.data_b64, updated_at = now()`;
  await logActivity({ actorId: me.id, action: "Updated logo", detail: variant === "dark" ? "Dark background logo" : "Light background logo", area: "ADMIN", href: "/ops/settings/organization" });
});
route("DELETE", "/settings/organization/logo/:variant", async ({ req, params }) => {
  const me = await admin(req);
  await sql`delete from ops.org_assets where key = ${params.variant === "dark" ? "logo-dark" : "logo"}`;
  await logActivity({ actorId: me.id, action: "Removed logo", detail: params.variant, area: "ADMIN" });
});

/* ═════════════ Sundays as a service: pricing, organizations, billing, super admins ═════════════ */

const ORG_TYPES = ["CHURCH", "NONPROFIT", "SCHOOL", "BUSINESS"] as const;
const ORG_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"] as const;

async function catalog(includeHidden = false) {
  const [plans, modules, [settings]] = await Promise.all([
    raw`select * from ops.plans ${includeHidden ? raw`` : raw`where active and public`} order by sort_order, price_monthly_cents, name`,
    raw`select * from ops.modules order by sort_order`,
    raw`select * from ops.platform_settings where id = 'platform'`,
  ]);
  return { plans, modules, settings: settings ?? { churchDiscountBps: 1500, trialDays: 14, defaultPlanId: null } };
}
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const billingOf = (o: Record<string, any>) => ({
  orgType: o.orgType, planId: o.planId, billingInterval: o.billingInterval, fullLicense: o.fullLicense, moduleOverrides: o.moduleOverrides ?? {},
  churchDiscount: o.churchDiscount, discountBps: o.discountBps, discountCents: o.discountCents, discountEndsAt: o.discountEndsAt,
});

/** Plans and add-ons for the pricing page and sign-up (whatever the super admins have set up). */
route("GET", "/public/pricing", async () => {
  const { plans, modules, settings } = await catalog();
  return { plans, modules: modules.filter((m) => m.active), churchDiscountBps: settings.churchDiscountBps, trialDays: settings.trialDays };
}, "public");

/** Anyone signed in can start an organization; they become its System admin. */
async function createOrg(input: { name: string; orgType: string; planId?: string | null; interval?: string; createdBy: string; fullLicense?: boolean; status?: string }) {
  const { plans, settings } = await catalog(true);
  const plan = plans.find((p) => p.id === input.planId && p.active) ?? plans.find((p) => p.id === settings.defaultPlanId) ?? plans[0] ?? null;
  const trialDays = plan?.trialDays ?? settings.trialDays ?? 14;
  return raw.begin(async (tx) => {
    const [o] = await tx`insert into ops.organization ${tx({
      name: input.name.trim(), orgType: input.orgType, planId: plan?.id ?? null, billingInterval: input.interval === "YEARLY" ? "YEARLY" : "MONTHLY",
      status: input.status ?? (input.fullLicense ? "ACTIVE" : "TRIAL"), trialEndsAt: input.fullLicense ? null : new Date(Date.now() + trialDays * 86_400_000),
      fullLicense: !!input.fullLicense, createdBy: input.createdBy, quotePrefix: input.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "ORG",
    })} returning *`;
    await tx`select ops.seed_org(${o.id})`;
    await tx`insert into ops.avl_business (id, name, quote_prefix) values (${o.id}, ${o.name}, 'AV') on conflict (id) do nothing`;
    return o;
  });
}

route("POST", "/orgs", async ({ acc, body }) => {
  const input = z.object({
    name: z.string().trim().min(2).max(120), orgType: z.enum(ORG_TYPES), planId: z.string().nullish(), interval: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
  }).parse(await body());
  const owned = acc.memberships.filter((m) => m.role === "ADMIN" && m.source !== "PLATFORM").length;
  if (owned >= 5 && !acc.platform) throw new HttpError(429, "You already run five organizations. Contact Sundays to add more.");
  const o = await createOrg({ ...input, createdBy: acc.auth.id });
  await raw`insert into ops.users ${raw({
    orgId: o.id, authId: acc.auth.id, email: acc.auth.email, name: acc.auth.name ?? acc.auth.email.split("@")[0], active: true, pending: false, registered: true,
    role: "ADMIN", allCampuses: true, avlLevel: "MANAGER", opsAccess: true, approvedAt: new Date(),
  })}`;
  return { id: o.id };
}, "account");

/** This organization's plan, modules, what it pays and its invoices (System admins). */
route("GET", "/billing", async ({ req }) => {
  await admin(req);
  const o = reqCtx()!.org;
  const { plans, modules, settings } = await catalog(true);
  const plan = plans.find((p) => p.id === o.planId) ?? null;
  const [invoices, [{ n: members }], [{ n: campuses }]] = await Promise.all([
    sql`select * from ops.invoices where status <> 'DRAFT' order by created_at desc limit 50`,
    sql`select count(*)::int as n from ops.users where active and source <> 'PLATFORM'`,
    sql`select count(*)::int as n from ops.campuses where active`,
  ]);
  return {
    org: { id: o.id, name: o.name, orgType: o.orgType, status: o.status, trialEndsAt: iso(o.trialEndsAt), billingInterval: o.billingInterval, billingEmail: o.billingEmail, fullLicense: o.fullLicense },
    plan, modules: modules.filter((m) => m.active), enabled: reqCtx()!.modules, bill: computeBill(billingOf(o), plan, modules, settings.churchDiscountBps),
    invoices, members, campuses,
  };
});

/* ───── Super-admin console (platform) ───── */

async function orgRows(where = raw`true`) {
  const { plans, modules, settings } = await catalog(true);
  const rows = await raw`select o.*, (select count(*)::int from ops.users u where u.org_id = o.id and u.active and u.source <> 'PLATFORM') as members
    from ops.organization o where ${where} order by o.created_at desc`;
  return rows.map((o) => {
    const plan = plans.find((p) => p.id === o.planId) ?? null;
    const bill = computeBill(billingOf(o), plan, modules, settings.churchDiscountBps);
    return {
      id: o.id, name: o.name, orgType: o.orgType, status: o.status, planId: o.planId, planName: plan?.name ?? null, fullLicense: o.fullLicense,
      members: o.members, createdAt: iso(o.createdAt), trialEndsAt: iso(o.trialEndsAt), totalCents: bill.totalCents, billingInterval: o.billingInterval,
    };
  });
}
const monthly = (r: { totalCents: number; billingInterval: string }) => (r.billingInterval === "YEARLY" ? Math.round(r.totalCents / 12) : r.totalCents);

route("GET", "/platform/overview", async () => {
  const rows = await orgRows();
  const [[{ n: people }], [{ c: openInvoices }]] = await Promise.all([
    raw`select count(distinct auth_id)::int as n from ops.users where auth_id is not null and source <> 'PLATFORM'`,
    raw`select coalesce(sum(total_cents), 0)::bigint as c from ops.invoices where status = 'SENT'`,
  ]);
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    orgs: rows.length, active: by("ACTIVE"), trial: by("TRIAL"), pastDue: by("PAST_DUE"), suspended: by("SUSPENDED") + by("CANCELLED"),
    fullLicense: rows.filter((r) => r.fullLicense).length, people,
    mrrCents: rows.filter((r) => r.status === "ACTIVE" || r.status === "PAST_DUE").reduce((s, r) => s + monthly(r), 0),
    openInvoicesCents: Number(openInvoices), recent: rows.slice(0, 8),
  };
}, "platform");

route("GET", "/platform/orgs", async ({ url }) => {
  const q = url.searchParams.get("q")?.trim();
  const status = ORG_STATUSES.find((s) => s === url.searchParams.get("status"));
  return orgRows(raw`true ${q ? raw`and o.name ilike ${"%" + q + "%"}` : raw``} ${status ? raw`and o.status = ${status}` : raw``}`);
}, "platform");

route("POST", "/platform/orgs", async ({ acc, body }) => {
  const input = z.object({
    name: z.string().trim().min(2).max(120), orgType: z.enum(ORG_TYPES), planId: z.string().nullish(), fullLicense: z.boolean().default(false),
    ownerEmail: z.string().email().nullish().or(z.literal("")).transform((v) => (v ? v.toLowerCase() : null)), ownerName: z.string().max(200).nullish(),
  }).parse(await body());
  const o = await createOrg({ ...input, createdBy: acc.auth.id });
  if (input.ownerEmail) {
    // Their System admin: straight in when they sign up (or sign in) with this email.
    const [existing] = await raw`select id from auth.users where lower(email) = ${input.ownerEmail} limit 1`.catch(() => [] as any[]);
    await raw`insert into ops.users ${raw({
      orgId: o.id, email: input.ownerEmail, name: input.ownerName?.trim() || input.ownerEmail.split("@")[0], authId: existing?.id ?? null, registered: !!existing,
      active: true, pending: false, role: "ADMIN", allCampuses: true, avlLevel: "MANAGER", opsAccess: true, approvedAt: new Date(),
    })}`;
  }
  return { id: o.id };
}, "platform");

route("GET", "/platform/orgs/:id", async ({ params }) => {
  const [o] = await raw`select * from ops.organization where id = ${params.id}`;
  if (!o) throw new HttpError(404, "Organization not found");
  const { plans, modules, settings } = await catalog(true);
  const plan = plans.find((p) => p.id === o.planId) ?? null;
  const [members, invoices] = await Promise.all([
    raw`select id, name, email, role, avl_level, active, pending, registered, last_login_at from ops.users where org_id = ${o.id} and source <> 'PLATFORM' order by role = 'ADMIN' desc, name`,
    raw`select * from ops.invoices where org_id = ${o.id} order by created_at desc limit 100`,
  ]);
  return {
    org: {
      id: o.id, name: o.name, orgType: o.orgType, status: o.status, planId: o.planId, billingInterval: o.billingInterval, billingEmail: o.billingEmail,
      trialEndsAt: iso(o.trialEndsAt), fullLicense: o.fullLicense, moduleOverrides: o.moduleOverrides ?? {}, churchDiscount: o.churchDiscount,
      discountBps: o.discountBps, discountCents: o.discountCents, discountEndsAt: iso(o.discountEndsAt), discountNote: o.discountNote, adminNotes: o.adminNotes, createdAt: iso(o.createdAt),
    },
    plans, modules, enabled: effectiveModules({ fullLicense: o.fullLicense, moduleOverrides: o.moduleOverrides ?? {} }, plan),
    bill: computeBill(billingOf(o), plan, modules, settings.churchDiscountBps), churchDiscountBps: settings.churchDiscountBps, members, invoices,
  };
}, "platform");

route("PUT", "/platform/orgs/:id", async ({ params, body }) => {
  const input = z.object({
    name: z.string().trim().min(2).max(120), orgType: z.enum(ORG_TYPES), status: z.enum(ORG_STATUSES), planId: z.string().nullish().transform((v) => v || null),
    billingInterval: z.enum(["MONTHLY", "YEARLY"]), billingEmail: z.string().email().nullish().or(z.literal("")).transform((v) => v || null),
    trialEndsAt: z.string().nullish().transform((v) => (v ? new Date(v) : null)), fullLicense: z.boolean(),
    moduleOverrides: z.record(z.enum(MODULE_KEYS as [ModuleKey, ...ModuleKey[]]), z.boolean()).default({}), churchDiscount: z.boolean(),
    discountBps: z.number().int().min(0).max(10_000), discountCents: z.number().int().min(0).max(100_000_000),
    discountEndsAt: z.string().nullish().transform((v) => (v ? new Date(v) : null)), discountNote: z.string().max(500).nullish(), adminNotes: z.string().max(10_000).nullish(),
  }).parse(await body());
  const [o] = await raw`update ops.organization set ${raw({ ...input, moduleOverrides: raw.json(input.moduleOverrides), updatedAt: new Date() })} where id = ${params.id} returning id`;
  if (!o) throw new HttpError(404, "Organization not found");
}, "platform");

/* Plans and add-on modules: changes show up on the pricing page and sign-up straight away. */
const PlanSchema = z.object({
  name: z.string().trim().min(1).max(80), tagline: z.string().max(200).nullish(), priceMonthlyCents: z.number().int().min(0).max(100_000_000),
  priceYearlyCents: z.number().int().min(0).max(1_000_000_000), modules: z.array(z.enum(MODULE_KEYS as [ModuleKey, ...ModuleKey[]])).default([]),
  maxUsers: z.number().int().min(1).nullish().transform((v) => v ?? null), maxCampuses: z.number().int().min(1).nullish().transform((v) => v ?? null),
  trialDays: z.number().int().min(0).max(365).default(14), public: z.boolean().default(true), active: z.boolean().default(true),
  highlight: z.boolean().default(false), sortOrder: z.number().int().default(0),
});
route("GET", "/platform/catalog", async () => {
  const { plans, modules, settings } = await catalog(true);
  const counts = await raw`select plan_id, count(*)::int as n from ops.organization group by plan_id`;
  return { plans: plans.map((p) => ({ ...p, orgs: counts.find((c) => c.planId === p.id)?.n ?? 0 })), modules, settings };
}, "platform");
route("POST", "/platform/plans", async ({ body }) => {
  const [p] = await raw`insert into ops.plans ${raw(PlanSchema.parse(await body()))} returning id`;
  return p;
}, "platform");
route("PUT", "/platform/plans/:id", async ({ params, body }) => {
  await raw`update ops.plans set ${raw({ ...PlanSchema.parse(await body()), updatedAt: new Date() })} where id = ${params.id}`;
}, "platform");
route("PUT", "/platform/modules/:key", async ({ params, body }) => {
  const m = z.object({ name: z.string().min(1).max(80), description: z.string().max(300).nullish(), priceMonthlyCents: z.number().int().min(0), priceYearlyCents: z.number().int().min(0), active: z.boolean() }).parse(await body());
  await raw`update ops.modules set ${raw(m)} where key = ${params.key}`;
}, "platform");
route("PUT", "/platform/settings", async ({ body }) => {
  const s = z.object({ churchDiscountBps: z.number().int().min(0).max(10_000), trialDays: z.number().int().min(0).max(365), defaultPlanId: z.string().nullish() }).parse(await body());
  await raw`update ops.platform_settings set ${raw({ ...s, defaultPlanId: s.defaultPlanId || null, updatedAt: new Date() })} where id = 'platform'`;
}, "platform");

/* Invoices: drafted from each organization's plan, sent, marked paid (Stripe takes over later). */
async function invoiceNumber() {
  const [{ n }] = await raw`select nextval('ops.invoice_seq')::int as n`;
  return `SUN-${new Date().getFullYear()}-${String(n).padStart(5, "0")}`;
}
route("GET", "/platform/invoices", async ({ url }) => {
  const status = ["DRAFT", "SENT", "PAID", "VOID"].find((s) => s === url.searchParams.get("status"));
  return raw`select i.*, o.name as org_name from ops.invoices i join ops.organization o on o.id = i.org_id
    where true ${status ? raw`and i.status = ${status}` : raw``} order by i.created_at desc limit 500`;
}, "platform");

/** Draft this period's invoice for every paying organization (skips full licenses, trials, $0 and ones already drafted). */
route("POST", "/platform/invoices/generate", async ({ acc, body }) => {
  const { period } = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }).parse(await body());
  const { plans, modules, settings } = await catalog(true);
  const orgs = await raw`select * from ops.organization where status in ('ACTIVE','PAST_DUE') and not full_license`;
  let created = 0, skipped = 0;
  for (const o of orgs) {
    const yearly = o.billingInterval === "YEARLY";
    const per = yearly ? period.slice(0, 4) : period;
    const plan = plans.find((p) => p.id === o.planId) ?? null;
    const bill = computeBill(billingOf(o), plan, modules, settings.churchDiscountBps);
    const [dupe] = await raw`select 1 from ops.invoices where org_id = ${o.id} and period = ${per} and status <> 'VOID'`;
    if (dupe || bill.totalCents <= 0) { skipped++; continue; }
    await raw`insert into ops.invoices ${raw({
      orgId: o.id, number: await invoiceNumber(), period: per, description: `${plan?.name ?? "Sundays"} · ${yearly ? per : period}`,
      lines: raw.json(bill.lines.map((l) => ({ label: l.label, amountCents: l.amountCents }))), subtotalCents: bill.subtotalCents, discountCents: bill.discountCents,
      totalCents: bill.totalCents, dueAt: new Date(Date.now() + 15 * 86_400_000), createdBy: acc.auth.email,
    })}`;
    created++;
  }
  return { created, skipped };
}, "platform");

route("POST", "/platform/invoices", async ({ acc, body }) => {
  const i = z.object({
    orgId: z.string().min(1), description: z.string().min(1).max(200), period: z.string().max(10).nullish(),
    lines: z.array(z.object({ label: z.string().min(1).max(200), amountCents: z.number().int() })).min(1).max(50),
    dueAt: z.string().nullish(), notes: z.string().max(5000).nullish(),
  }).parse(await body());
  const subtotal = i.lines.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
  const total = Math.max(0, i.lines.reduce((s, l) => s + l.amountCents, 0));
  const [row] = await raw`insert into ops.invoices ${raw({
    orgId: i.orgId, number: await invoiceNumber(), period: i.period || null, description: i.description, lines: raw.json(i.lines),
    subtotalCents: subtotal, discountCents: subtotal - total, totalCents: total, dueAt: i.dueAt ? new Date(i.dueAt) : null, notes: i.notes ?? null, createdBy: acc.auth.email,
  })} returning id`;
  return row;
}, "platform");

route("PUT", "/platform/invoices/:id", async ({ params, body }) => {
  const { status, notes } = z.object({ status: z.enum(["DRAFT", "SENT", "PAID", "VOID"]), notes: z.string().max(5000).nullish() }).parse(await body());
  const [row] = await raw`update ops.invoices set ${raw({
    status, ...(notes !== undefined ? { notes } : {}),
    ...(status === "SENT" ? { sentAt: new Date() } : {}), ...(status === "PAID" ? { paidAt: new Date() } : {}),
  })} where id = ${params.id} returning id`;
  if (!row) throw new HttpError(404, "Invoice not found");
}, "platform");

/* Super admins. */
route("GET", "/platform/admins", async () => raw`select * from ops.platform_admins order by created_at`, "platform");
route("POST", "/platform/admins", async ({ acc, body }) => {
  const { email } = z.object({ email: z.string().email().transform((e) => e.toLowerCase()) }).parse(await body());
  const [existing] = await raw`select id from auth.users where lower(email) = ${email} limit 1`.catch(() => [] as any[]);
  await raw`insert into ops.platform_admins ${raw({ email, authId: existing?.id ?? null, addedBy: acc.auth.email })} on conflict (email) do nothing`;
}, "platform");
route("DELETE", "/platform/admins/:id", async ({ acc, params }) => {
  const [a] = await raw`select * from ops.platform_admins where id = ${params.id}`;
  if (!a) throw new HttpError(404, "Not found");
  if (a.authId === acc.auth.id) throw new HttpError(409, "You can't remove yourself. Another super admin can.");
  await raw`delete from ops.platform_admins where id = ${params.id}`;
}, "platform");

/* ───────────── Email ───────────── */

const MailInput = z.object({
  provider: z.enum(["sundays", "brevo", "resend", "off"]),
  apiKey: z.string().max(300).nullish(), // undefined keeps the saved one, "" removes it
  fromEmail: z.string().max(200).nullish(),
  fromName: z.string().max(120).nullish(),
  replyTo: z.string().max(200).nullish(),
});
const cleanEmail = (v: string | null | undefined, what: string) => {
  const t = v?.trim() || null;
  if (t && !isEmail(t)) throw new HttpError(422, `The ${what} doesn’t look like an email address.`);
  return t;
};

/** Settings → Organization → Email. */
route("GET", "/settings/email", async ({ req }) => {
  await admin(req);
  const m = await mailSettings();
  const relayInfo = await relayAvailable();
  const recent = await sql`select kind, recipient, subject, status, error, created_at from ops.mail_log order by created_at desc limit 20`;
  return {
    provider: m.provider, hasKey: Boolean(m.apiKeyEnc), fromEmail: m.fromEmail, fromName: m.fromName, replyTo: m.replyTo,
    notifyTeam: m.notifyTeam, notifyApprovers: m.notifyApprovers, notifyAssignee: m.notifyAssignee, notifyRequester: m.notifyRequester,
    relay: { available: relayInfo.available }, recent,
  };
});
route("PUT", "/settings/email", async ({ req, body }) => {
  const me = await admin(req);
  const b = MailInput.extend({ notifyTeam: z.boolean(), notifyApprovers: z.boolean(), notifyAssignee: z.boolean(), notifyRequester: z.boolean() }).parse(await body());
  const cur = await mailSettings();
  const apiKeyEnc = await keyUpdate(b.apiKey, cur.apiKeyEnc ?? null);
  const fromEmail = cleanEmail(b.fromEmail, "sending address");
  if ((b.provider === "brevo" || b.provider === "resend") && (!apiKeyEnc || !fromEmail)) throw new HttpError(422, "Add the API key and the sending address from your email service.");
  const row = {
    provider: b.provider, apiKeyEnc, fromEmail, fromName: b.fromName?.trim() || null, replyTo: cleanEmail(b.replyTo, "reply-to address"),
    notifyTeam: b.notifyTeam, notifyApprovers: b.notifyApprovers, notifyAssignee: b.notifyAssignee, notifyRequester: b.notifyRequester,
    updatedBy: me.name, updatedAt: new Date(),
  };
  await sql`insert into ops.mail_settings ${sql(row)} on conflict (org_id) do update set ${sql(row)}`;
  await logActivity({ actorId: me.id, action: "Updated email settings", detail: b.provider === "sundays" ? "Sent by Sundays" : b.provider === "off" ? "Off" : `Own ${b.provider} account`, area: "ADMIN", href: "/ops/settings/organization" });
});
/** Send a test to yourself (straight away, so you see what went wrong). */
route("POST", "/settings/email/test", async ({ req }) => {
  const me = await admin(req);
  const m = await mailSettings();
  const org = await getOrg();
  const name = (org.name as string) || "Your church";
  const { sender, why } = await senderFor(m, m.fromName || name);
  const { html, text } = render({ org: name, heading: "Sundays email works", intro: [`This is a test from Sundays, sent by ${me.name}. Request emails for ${name} will look like this and come from the same address.`] });
  const err = await send(sender, { to: { email: me.email, name: me.name }, subject: "Test email from Sundays", html, text, replyTo: m.replyTo ?? null }, { orgId: orgId(), kind: "test" }, why);
  if (err) throw new HttpError(422, err);
  return { ok: true, to: me.email };
});

/** Sundays' relay (admin console): the email service every organization can send through. */
route("GET", "/platform/email", async () => {
  const [p] = await raw`select * from ops.platform_mail where id = 'platform'`;
  const recent = await raw`select l.kind, l.recipient, l.subject, l.status, l.error, l.created_at, o.name as who
    from ops.mail_log l left join ops.organization o on o.id = l.org_id
    order by l.created_at desc limit 30`;
  const [{ today }] = await raw`select count(*)::int as today from ops.mail_log where status = 'SENT' and created_at > now() - interval '1 day'`;
  return { provider: p?.provider ?? "brevo", hasKey: Boolean(p?.apiKeyEnc), fromEmail: p?.fromEmail ?? null, fromName: p?.fromName ?? "Sundays", updatedBy: p?.updatedBy ?? null, today, recent };
}, "platform");
route("PUT", "/platform/email", async ({ acc, body }) => {
  const b = z.object({ provider: z.enum(["brevo", "resend"]), apiKey: z.string().max(300).nullish(), fromEmail: z.string().max(200).nullish(), fromName: z.string().max(120).nullish() }).parse(await body());
  const [cur] = await raw`select api_key_enc from ops.platform_mail where id = 'platform'`;
  const row = {
    id: "platform", provider: b.provider, apiKeyEnc: await keyUpdate(b.apiKey, cur?.apiKeyEnc ?? null), fromEmail: cleanEmail(b.fromEmail, "sending address"),
    fromName: b.fromName?.trim() || "Sundays", updatedBy: acc.auth.email, updatedAt: new Date(),
  };
  await raw`insert into ops.platform_mail ${raw(row)} on conflict (id) do update set ${raw(row, "provider", "apiKeyEnc", "fromEmail", "fromName", "updatedBy", "updatedAt")}`;
}, "platform");
route("POST", "/platform/email/test", async ({ acc }) => {
  const to = acc.auth.email;
  if (!to) throw new HttpError(422, "Your account has no email address.");
  const { sender, why } = await senderFor({ provider: "sundays" as MailChoice }, "Sundays");
  const { html, text } = render({ org: "Sundays", heading: "Sundays’ email relay works", intro: ["Every organization that hasn’t set up its own email service now sends through this one."] });
  const err = await send(sender, { to: { email: to }, subject: "Test of Sundays’ email relay", html, text }, { kind: "test" }, why);
  if (err) throw new HttpError(422, err);
  return { ok: true, to };
}, "platform");
