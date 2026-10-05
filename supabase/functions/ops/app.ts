/**
 * Church Ops API for Sundays (Edge Function "ops"). Ported from coolchurch-ops: the request hub
 * (technology, supplies, facilities work orders), AVL quoting, vendors and price lists, and the
 * people, teams, campuses and request types behind them.
 *
 * Sign-in is Sundays' own (Supabase Auth: register, then a manager approves you). Every call checks
 * the person's role, AVL level and campus scope from the database (see lib/rbac.ts).
 *
 *   /ops/me · /ops/overview
 *   /ops/requests… · /ops/work
 *   /ops/quotes… · /ops/customers · /ops/catalog · /ops/vendors…
 *   /ops/settings/{users,teams,request-types,supply-items,campuses,activity,organization}…
 */
import { z, ZodError } from "zod";
import {
  atLeast, can, canAccessCampus, canEditUser, canManageCampus, canViewActivity, checkUserGrant, effectiveAccess, grantableRoles,
  hasAvlAccess, isAdmin, isGlobalManager, roleLabel, seesAllCampuses,
} from "./lib/rbac.ts";
import { OPEN_STATUSES, type RequestKind } from "./lib/workflow.ts";
import { isDeletable, QUOTE_STATUSES, type QuoteStatus } from "./lib/state-machine.ts";
import type { OpsSessionUser, OverviewData, QuoteRow, UserRow } from "./lib/types.ts";
import { defined, getOrg, HttpError, logActivity, sql } from "./db.ts";
import { caller, requireUser } from "./auth.ts";
import { addRequestComment, handlesRequests, performRequestAction, requestDetail, requestRows, submitRequest, workQueueWhere } from "./requests.ts";
import { applyEvent, createQuote, effectiveTotals, liveTotals, loadQuote, quoteDTO, saveQuote, toPublicQuote, type FullQuote } from "./quotes.ts";

type U = OpsSessionUser;
type Ctx = { req: Request; url: URL; params: Record<string, string>; body: () => Promise<any> };
type Handler = (c: Ctx) => Promise<unknown>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const routes: { method: string; re: RegExp; keys: string[]; fn: Handler }[] = [];
function route(method: string, path: string, fn: Handler) {
  const keys: string[] = [];
  const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; })}$`);
  routes.push({ method, re, keys, fn });
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  // /functions/v1/ops/x, /ops/x → /x
  const path = url.pathname.replace(/^.*?\/ops(?=\/|$)/, "") || "/";
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      let parsed: unknown;
      const out = await r.fn({ req, url, params, body: async () => (parsed ??= await req.json().catch(() => ({}))) });
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
  if (!hasAvlAccess(u)) throw new HttpError(403, "AVL access required");
  if (perm && !can(u, perm)) throw new HttpError(403, "An AVL Manager has to do that.");
  return u;
};
const manager = async (req: Request) => {
  const u = await requireUser(req);
  if (!atLeast(u, "MANAGER")) throw new HttpError(403, "Manager access required");
  return u;
};
const admin = async (req: Request) => {
  const u = await requireUser(req);
  if (!isAdmin(u)) throw new HttpError(403, "System admin access required");
  return u;
};
const globalOnly = (u: U, what: string) => { if (!isGlobalManager(u)) throw new HttpError(403, `Only global managers and executives can ${what}.`); };

const optStr = (max = 200) => z.string().max(max).nullish().transform((v) => (v ? v : null));
const id = z.string().min(1);

/* ───────────── Me / organization brand ───────────── */

async function brand() {
  const org = await getOrg();
  const assets = await sql`select key, mime, data_b64 from ops.org_assets`;
  const a = (k: string) => assets.find((x) => x.key === k);
  const url = (x?: Record<string, any>) => (x ? `data:${x.mime};base64,${x.dataB64}` : null);
  return { name: org.name as string | null, logo: url(a("logo")), logoDark: url(a("logo-dark") ?? a("logo")) };
}

route("GET", "/me", async ({ req }) => {
  const c = await caller(req);
  const org = await brand();
  if (!c.row.active) return { status: c.row.pending ? "pending" : "inactive", name: c.row.name, email: c.row.email, org };
  const u = await requireUser(req);
  const handles = await handlesRequests(u);
  const [[{ n: queueCount }], [{ n: pendingUsers }], [campus]] = await Promise.all([
    handles ? sql`select count(*)::int as n from ops.requests r where ${workQueueWhere(u, { openOnly: true })}` : [{ n: 0 }],
    atLeast(u, "MANAGER")
      ? sql`select count(*)::int as n from ops.users where pending ${seesAllCampuses(u) ? sql`` : sql`and (campus_id = ${u.campusId} or campus_id is null)`}`
      : [{ n: 0 }],
    u.campusId ? sql`select name from ops.campuses where id = ${u.campusId}` : [],
  ]);
  return {
    status: "ok", user: u, org,
    nav: { handlesRequests: handles, queueCount, pendingUsers, avl: hasAvlAccess(u), manager: atLeast(u, "MANAGER"), admin: isAdmin(u), campusName: campus?.name ?? null },
  };
});

/** Sundays fills in the church name from Planning Center the first time (only if it's still empty). */
route("POST", "/bootstrap", async ({ req, body }) => {
  await requireUser(req);
  const { orgName } = z.object({ orgName: z.string().min(1).max(200) }).parse(await body());
  await sql`update ops.organization set name = ${orgName.trim()}, updated_at = now() where id = 'org' and (name is null or name = '')`;
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
  const u = await requireUser(req);
  const isAvl = hasAvlAccess(u);
  const handles = await handlesRequests(u);
  const seesAll = atLeast(u, "MANAGER") && seesAllCampuses(u);
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  let avlData: OverviewData["avl"] = null;
  if (isAvl) {
    const [active, accepted, [{ open }], recent] = await Promise.all([
      quotesWith(sql`q.status in ('DRAFT','SENT','CHANGES_REQUESTED')`, { limit: 1000 }),
      quotesWith(sql`q.status in ('ACCEPTED','CONVERTED') and q.accepted_at >= ${yearStart}`, { limit: 1000 }),
      sql`select coalesce(sum(i.quantity * i.unit_cost_cents), 0)::bigint as open from ops.purchase_order_items i join ops.purchase_orders p on p.id = i.po_id where p.status in ('DRAFT','ORDERED','PARTIAL')`,
      quotesWith(sql`true`, { limit: 5 }),
    ]);
    avlData = {
      pipelineCents: active.reduce((s, q) => s + effectiveTotals(q).totalCents, 0),
      acceptedCents: accepted.reduce((s, q) => s + effectiveTotals(q).totalCents, 0),
      profitCents: accepted.reduce((s, q) => s + liveTotals(q).grossProfitCents, 0),
      openPurchasingCents: Number(open), recent: recent.map(quoteRow),
    };
  }
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
  const scope = seesAll ? sql`true` : sql`(a.actor_id = ${u.id}
    ${isAvl ? sql`or a.area = 'AVL'` : sql``}
    ${atLeast(u, "MANAGER") && u.campusId ? sql`or a.campus_id = ${u.campusId}` : sql``})`;
  const activity = await sql`select a.id, a.actor_label, a.action, a.detail, a.area, a.href, a.created_at, x.name as actor_name
    from ops.activity_log a left join ops.users x on x.id = a.actor_id where ${scope} order by a.created_at desc limit 8`;
  const [{ n: awaiting }] = await sql`select count(*)::int as n from ops.requests where requester_id = ${u.id} and status = 'PENDING_APPROVAL'`;
  return {
    avl: avlData, queue, mine: { open: mineOpen, awaiting, completed30 }, activity, canViewActivity: canViewActivity(u),
  } satisfies Record<keyof OverviewData, unknown>;
});

/* ───────────── Requests ───────────── */

route("GET", "/requests/mine", async ({ req }) => {
  const u = await requireUser(req);
  return requestRows(sql`r.requester_id = ${u.id}`, sql`r.created_at desc`, 200);
});

route("GET", "/requests/new", async ({ req }) => {
  const u = await requireUser(req);
  const [cats, items, campuses] = await Promise.all([
    sql`select id, name, kind, workflow, description, icon, requires_location, allow_line_items, approval_threshold_cents
        from ops.request_categories where active order by sort_order, name`,
    sql`select id, category_id, name, unit, unit_cost_cents from ops.supply_items where active order by sort_order, name`,
    sql`select id, name from ops.campuses where active order by sort_order, name`,
  ]);
  return {
    categories: cats.map((c) => ({ ...c, supplyItems: items.filter((i) => i.categoryId === c.id).map(({ categoryId: _c, ...i }) => i) })),
    campuses, defaultCampusId: u.campusId,
  };
});

route("POST", "/requests", async ({ req, body }) => {
  const u = await requireUser(req);
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

route("GET", "/requests/:id", async ({ req, params }) => requestDetail(await requireUser(req), params.id));

route("POST", "/requests/:id/actions", async ({ req, params, body }) => {
  const u = await requireUser(req);
  const input = z.object({
    action: z.enum(["APPROVE", "DENY", "ASSIGN", "START", "HOLD", "ORDER", "COMPLETE", "CANCEL", "REOPEN"]),
    note: z.string().max(5000).optional(), assigneeId: z.string().optional(),
  }).parse(await body());
  const r = await performRequestAction(u, params.id, input);
  return { status: r.status };
});

route("POST", "/requests/:id/comments", async ({ req, params, body }) => {
  const u = await requireUser(req);
  const { body: text, internal } = z.object({ body: z.string().min(1).max(5000), internal: z.boolean().default(false) }).parse(await body());
  return addRequestComment(u, params.id, text, internal);
});

const WORK_TABS = ["open", "approval", "mine", "done"] as const;
route("GET", "/work", async ({ req, url }) => {
  const u = await requireUser(req);
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
    seesAllCampuses(u) ? sql`select id, name from ops.campuses where active order by sort_order, name` : [],
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
  const q = url.searchParams.get("q")?.trim();
  const like = q ? `%${q}%` : null;
  const [quotes, counts, customers, campuses] = await Promise.all([
    quotesWith(sql`true ${status ? sql`and q.status = ${status}` : sql``} ${campus ? sql`and q.campus_id = ${campus}` : sql``}
      ${like ? sql`and (q.number ilike ${like} or q.title ilike ${like} or q.customer_id in (select id from ops.customers where name ilike ${like}))` : sql``}`),
    sql`select status, count(*)::int as n from ops.quotes group by status`,
    sql`select id, name from ops.customers order by name`,
    sql`select id, name from ops.campuses where active order by sort_order, name`,
  ]);
  return { quotes: quotes.map(quoteRow), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), customers, campuses, defaultCampusId: u.campusId };
});

route("POST", "/quotes", async ({ req, body }) => {
  const u = await avl(req);
  const input = z.object({ title: z.string().min(1).max(200), customerId: id, campusId: z.string().nullish() }).parse(await body());
  const q = await createQuote({ ...input, createdById: u.id });
  await logActivity({ actorId: u.id, action: "Created quote", detail: `${q.number} · ${q.title}`, area: "AVL", entityType: "Quote", entityId: q.id, href: `/ops/quotes/view?id=${q.id}`, campusId: q.campusId });
  return { id: q.id, number: q.number };
});

route("GET", "/quotes/:id", async ({ req, params }) => {
  const u = await avl(req);
  const [quote, customers, vendors, campuses, org] = await Promise.all([
    quoteDTO(params.id),
    sql`select id, name, email, tax_exempt from ops.customers order by name`,
    sql`select id, name from ops.vendors where active order by name`,
    sql`select id, name from ops.campuses where active order by sort_order, name`,
    getOrg(),
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
  const { event, note } = z.object({
    event: z.enum(["SEND", "REVISE", "REOPEN", "CONVERT", "MARK_ACCEPTED", "MARK_CHANGES", "MARK_DECLINED"]), note: z.string().max(5000).optional(),
  }).parse(await body());
  const u = await avl(req, event === "CONVERT" || event === "MARK_ACCEPTED" ? "QUOTE_APPROVE" : undefined);
  const q = await applyEvent({ quoteId: params.id, event, actor: "staff", actorId: u.id, note: note ?? (event === "SEND" ? "Pricing locked for the customer" : null) });
  const verb = { SEND: "Sent quote", REVISE: "Revised quote", REOPEN: "Reopened quote", CONVERT: "Converted quote", MARK_ACCEPTED: "Recorded acceptance", MARK_CHANGES: "Recorded change request", MARK_DECLINED: "Recorded decline" }[event];
  await logActivity({ actorId: u.id, action: verb, detail: q.number, area: "AVL", entityType: "Quote", entityId: q.id, href: `/ops/quotes/view?id=${q.id}`, campusId: q.campusId });
  return quoteDTO(params.id);
});

/** Print preview / PDF: exactly what the customer gets (no cost, margin or internal notes). */
route("GET", "/quotes/:id/print", async ({ req, params }) => {
  await avl(req);
  const [q, org, b] = await Promise.all([loadQuote(params.id), getOrg(), brand()]);
  const { id: _i, updatedAt: _u, ...settings } = org;
  return { quote: toPublicQuote(q), org: settings, logo: b.logo };
});

route("POST", "/customers", async ({ req, body }) => {
  await avl(req);
  const input = z.object({
    name: z.string().min(1).max(200), contactName: z.string().max(200).nullish(), email: z.string().email().nullish().or(z.literal("")).transform((v) => v || null),
    phone: z.string().max(50).nullish(), taxExempt: z.boolean().default(false),
  }).parse(await body());
  const [c] = await sql`insert into ops.customers ${sql(defined(input))} returning id, name, email, tax_exempt`;
  return c;
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
  await logActivity({ actorId: u.id, action: "Created vendor", detail: v.name, area: "AVL", entityType: "Vendor", entityId: v.id, href: `/ops/vendors/view?id=${v.id}` });
  return v;
});
route("PUT", "/vendors/:id", async ({ req, params, body }) => {
  await avl(req);
  const data = VendorSchema.partial().parse(await body());
  const [v] = await sql`update ops.vendors set ${sql({ ...defined(data), updatedAt: new Date() })} where id = ${params.id} returning *`;
  if (!v) throw new HttpError(404, "Vendor not found");
  return v;
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
  await logActivity({ actorId: u.id, action: "Imported price list", detail: `${vendor.name} · ${input.fileName} · +${toCreate} / ~${toUpdate}`, area: "AVL", entityType: "Vendor", entityId: vendor.id, href: `/ops/vendors/view?id=${vendor.id}` });
  return { committed: true, batch };
});

/* ───────────── Settings: users ───────────── */

const UserSchema = z.object({
  name: z.string().min(1).max(200), email: z.string().email().transform((e) => e.toLowerCase()),
  title: optStr(), department: optStr(), phone: optStr(50), campusId: id.nullish().transform((v) => v ?? null),
  allCampuses: z.boolean().default(false), role: z.enum(["STAFF", "MANAGER", "EXECUTIVE", "ADMIN"]).default("STAFF"),
  avlLevel: z.enum(["NONE", "TECH", "MANAGER"]).default("NONE"), teamIds: z.array(id).default([]), active: z.boolean().default(true),
});

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
    from ops.users u left join ops.campuses c on c.id = u.campus_id where ${where as never} order by u.pending desc, u.name limit 500`;
  return rows.map((u) => {
    const a = effectiveAccess(u as never);
    return {
      id: u.id, email: u.email, name: u.name, title: u.title, department: u.department, phone: u.phone, active: u.active, pending: u.pending,
      registered: u.registered, campusId: u.campusId, campusName: u.campusName, allCampuses: u.allCampuses, role: u.role, avlLevel: u.avlLevel,
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
    ${status === "pending" ? sql`and u.pending` : status === "inactive" ? sql`and not u.active and not u.pending` : sql`and u.active`}`;
  const [users, campuses, teams, [{ n: pending }]] = await Promise.all([
    userRows(me, where),
    sql`select id, name from ops.campuses where active order by sort_order, name`,
    sql`select id, name, campus_id from ops.teams where active order by name`,
    sql`select count(*)::int as n from ops.users u where u.pending ${global ? sql`` : sql`and (u.campus_id = ${me.campusId ?? "__none__"} or u.campus_id is null)`}`,
  ]);
  return {
    users, campuses, pending, global, grantableRoles: grantableRoles(me), myCampusId: me.campusId,
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
    user: u, campuses, self: me.id === u.id, global: seesAllCampuses(me), grantableRoles: me.id === u.id ? [] : grantableRoles(me),
    teams: teams.map((t) => ({ id: t.id, name: t.name, campusName: t.campusName, manageable: canManageCampus(me, t.campusId) })),
  };
});

route("POST", "/settings/users", async ({ req, body }) => {
  const actor = await manager(req);
  const { teamIds, ...data } = UserSchema.parse(await body());
  if (!seesAllCampuses(actor)) data.campusId = actor.campusId;
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
  if (existing.id === actor.id) {
    // Your own role, scope and status are changed by someone else.
    data.role = existing.role; data.allCampuses = existing.allCampuses; data.active = true;
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
    sql`select id, name from ops.users where active and id not in (select user_id from ops.team_members where team_id = ${team.id})
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
  return { categories: cats, campusCount, global: isGlobalManager(me) };
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
  const rows = global
    ? [...campuses.map((c) => ({ key: c.id, label: c.name, campusId: c.id })), { key: "ALL", label: "All other campuses (fallback)", campusId: null }]
    : campuses.filter((c) => canManageCampus(me, c.id)).map((c) => ({ key: c.id, label: c.name, campusId: c.id }));
  return { category: cat, routings, supplyItems: items, rows, teams, global, hasFallback: routings.some((r) => !r.campusId) };
});

route("POST", "/settings/request-types", async ({ req, body }) => {
  const me = await manager(req);
  globalOnly(me, "change request types");
  const [c] = await sql`insert into ops.request_categories ${sql(CategorySchema.parse(await body()))} returning *`;
  await logActivity({ actorId: me.id, action: "Created request type", detail: c.name, area: "ADMIN", entityType: "RequestCategory", entityId: c.id, href: `/ops/settings/request-types/view?id=${c.id}` });
  return { id: c.id };
});
route("PUT", "/settings/request-types/:id", async ({ req, params, body }) => {
  const me = await manager(req);
  globalOnly(me, "change request types");
  await sql`update ops.request_categories set ${sql(CategorySchema.parse(await body()))} where id = ${params.id}`;
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
    taxExempt: z.boolean(), defaultTaxBps: z.number().int().min(0).max(5000), defaultDepositBps: z.number().int().min(0).max(10_000),
    defaultMarginBps: z.number().int().min(0).max(9900), laborRateCents: cents, quoteValidDays: z.number().int().min(1).max(365), quoteTerms: optStr(20_000),
  }).parse(await body());
  await getOrg();
  await sql`update ops.organization set ${sql({ ...input, updatedAt: new Date() })} where id = 'org'`;
  await logActivity({ actorId: me.id, action: "Updated organization settings", area: "ADMIN", href: "/ops/settings/organization" });
});
route("POST", "/settings/organization/logo", async ({ req, body }) => {
  const me = await admin(req);
  const { variant, mime, dataB64 } = z.object({
    variant: z.enum(["light", "dark"]), mime: z.enum(["image/png", "image/jpeg", "image/svg+xml", "image/webp"]), dataB64: z.string().min(1).max(1_400_000),
  }).parse(await body());
  const key = variant === "dark" ? "logo-dark" : "logo";
  await sql`insert into ops.org_assets ${sql({ key, mime, dataB64, updatedAt: new Date() })}
    on conflict (key) do update set mime = excluded.mime, data_b64 = excluded.data_b64, updated_at = now()`;
  await logActivity({ actorId: me.id, action: "Updated logo", detail: variant === "dark" ? "Dark background logo" : "Light background logo", area: "ADMIN", href: "/ops/settings/organization" });
});
route("DELETE", "/settings/organization/logo/:variant", async ({ req, params }) => {
  const me = await admin(req);
  await sql`delete from ops.org_assets where key = ${params.variant === "dark" ? "logo-dark" : "logo"}`;
  await logActivity({ actorId: me.id, action: "Removed logo", detail: params.variant, area: "ADMIN" });
});
