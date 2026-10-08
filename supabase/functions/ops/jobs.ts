/**
 * AVL jobs: made from an accepted proposal (its lines become the job's budget) or by hand, and the
 * job's budget (a tree of cost groups and cost items; see lib/jobs.ts for the money).
 */
import { z } from "zod";
import { budgetTotals, DEFAULT_COST_GROUPS, type BudgetItem, type JobDetail, type JobDocument, type JobRow, type JobStatus } from "./lib/jobs.ts";
import { getAvl, HttpError, sql, type Tx } from "./db.ts";
import { effectiveTotals, loadQuote } from "./quotes.ts";

type Db = typeof sql | Tx;

const newId = () => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return "bi" + Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 22);
};

/** J-0001, J-0002… per organization. */
export async function nextJobNumber(db: Db, prefix: string) {
  const [row] = await db`insert into ops.counters (key, value) values ('JOB', 1)
    on conflict (org_id, key) do update set value = ops.counters.value + 1 returning value`;
  return `${prefix || "J"}-${String(row.value).padStart(4, "0")}`;
}

// deno-lint-ignore no-explicit-any
const toItem = (r: Record<string, any>): BudgetItem => ({
  id: r.id, parentId: r.parentId ?? null, kind: r.kind, name: r.name, description: r.description ?? null, costType: r.costType,
  quantity: Number(r.quantity), unit: r.unit ?? null, unitCostCents: Number(r.unitCostCents), unitPriceCents: Number(r.unitPriceCents),
  taxable: r.taxable, productId: r.productId ?? null, quoteItemId: r.quoteItemId ?? null, sortOrder: r.sortOrder,
});
export async function budgetOf(jobId: string, db: Db = sql): Promise<BudgetItem[]> {
  return (await db`select * from ops.budget_items where job_id = ${jobId} order by sort_order, id`).map(toItem);
}

/** Jobs with their client, proposal, manager and budget totals. */
export async function jobRows(where: unknown, limit = 500): Promise<JobRow[]> {
  const rows = await sql`
    select j.*, c.name as customer_name, q.number as quote_number, m.name as manager_name, t.cost, t.price
    from ops.jobs j
    left join ops.customers c on c.id = j.customer_id
    left join ops.quotes q on q.id = j.quote_id
    left join ops.users m on m.id = j.manager_id
    left join lateral (
      select coalesce(sum(round(b.quantity * b.unit_cost_cents)), 0)::bigint as cost, coalesce(sum(round(b.quantity * b.unit_price_cents)), 0)::bigint as price
      from ops.budget_items b where b.job_id = j.id and b.kind = 'ITEM'
    ) t on true
    where ${where as never}
    order by case j.status when 'IN_PROGRESS' then 0 when 'PLANNING' then 1 when 'ON_HOLD' then 2 else 3 end, j.updated_at desc
    limit ${limit}`;
  return rows.map((j) => {
    const cost = Number(j.cost), price = Number(j.price);
    return {
      id: j.id, number: j.number, name: j.name, status: j.status as JobStatus,
      customer: j.customerId ? { id: j.customerId, name: j.customerName } : null,
      quote: j.quoteId ? { id: j.quoteId, number: j.quoteNumber } : null,
      manager: j.managerId ? { id: j.managerId, name: j.managerName } : null,
      siteLine1: j.siteLine1, siteCity: j.siteCity, siteState: j.siteState,
      startDate: day(j.startDate), endDate: day(j.endDate),
      priceCents: price, costCents: cost, profitCents: price - cost, marginBps: price > 0 ? Math.round(((price - cost) / price) * 10_000) : 0,
      updatedAt: new Date(j.updatedAt).toISOString(),
    };
  });
}
const day = (d: unknown) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);

export async function jobDetail(id: string): Promise<JobDetail> {
  const [row] = await jobRows(sql`j.id = ${id}`, 1);
  if (!row) throw new HttpError(404, "Job not found");
  const [j] = await sql`select j.*, u.name as created_by_name from ops.jobs j left join ops.users u on u.id = j.created_by_id where j.id = ${id}`;
  return {
    ...row, campusId: j.campusId, managerId: j.managerId, customerId: j.customerId, siteLine2: j.siteLine2, sitePostalCode: j.sitePostalCode,
    notes: j.notes, createdAt: new Date(j.createdAt).toISOString(), createdBy: j.createdByName ?? null,
  };
}

export async function jobDocuments(job: JobDetail): Promise<JobDocument[]> {
  if (!job.quote) return [];
  const q = await loadQuote(job.quote.id);
  return [{
    kind: "PROPOSAL", id: q.id, number: q.number, title: q.title, status: q.status, totalCents: effectiveTotals(q).totalCents,
    date: q.sentAt ? new Date(q.sentAt).toISOString() : null,
    signature: q.signature ? {
      signerName: q.signature.signerName, signerEmail: q.signature.signerEmail, signerTitle: q.signature.signerTitle ?? null,
      signedAt: new Date(q.signature.signedAt).toISOString(), totalCents: q.signature.totalCentsAtSigning,
    } : null,
  }];
}

/**
 * The job for an accepted proposal (made once): the proposal's sections become cost groups and its
 * lines their cost items, so the budget starts as exactly what was sold. A discount becomes its own
 * line, so the budget's price matches the proposal before tax.
 */
export async function jobFromQuote(quoteId: string, userId: string, db: Db = sql): Promise<{ id: string; number: string; created: boolean }> {
  const [have] = await db`select id, number from ops.jobs where quote_id = ${quoteId}`;
  if (have) return { id: have.id, number: have.number, created: false };
  const q = await loadQuote(quoteId, db);
  if (!["ACCEPTED", "CONVERTED"].includes(q.status)) throw new HttpError(409, "Only an accepted proposal can become a job.");
  const avl = await getAvl(db);
  const [c] = await db`select address_line1, address_line2, city, state, postal_code from ops.customers where id = ${q.customerId}`;
  const [job] = await db`insert into ops.jobs ${db({
    number: await nextJobNumber(db, avl.jobPrefix), name: q.title, status: "PLANNING", customerId: q.customerId, quoteId: q.id,
    campusId: q.campusId ?? null, managerId: userId, createdById: userId,
    siteLine1: c?.addressLine1 ?? null, siteLine2: c?.addressLine2 ?? null, siteCity: c?.city ?? null, siteState: c?.state ?? null, sitePostalCode: c?.postalCode ?? null,
  })} returning id, number`;

  const rows: Record<string, unknown>[] = [];
  const groups = new Map<string, string>();
  let order = 0;
  // Options the client didn't choose aren't part of the job.
  for (const it of (q.items as Record<string, any>[]).filter((i) => i.selected !== false)) {
    const section = (it.section as string | null)?.trim() || "General";
    let gid = groups.get(section);
    if (!gid) {
      gid = newId(); groups.set(section, gid);
      rows.push({ id: gid, jobId: job.id, parentId: null, kind: "GROUP", name: section, description: null, costType: "OTHER", quantity: 0, unit: null, unitCostCents: 0, unitPriceCents: 0, taxable: true, productId: null, quoteItemId: null, sortOrder: order++ });
    }
    const labor = /labor|install|programming|commission|training/i.test(section) || /\b(hours?|hrs?)\b/i.test(it.name);
    rows.push({
      id: newId(), jobId: job.id, parentId: gid, kind: "ITEM", name: it.name, description: it.description ?? null, costType: labor ? "LABOR" : "MATERIAL",
      quantity: it.quantity, unit: labor ? "hr" : "ea", unitCostCents: it.unitCostCents, unitPriceCents: it.unitPriceCents, taxable: it.taxable,
      productId: it.productId ?? null, quoteItemId: it.id, sortOrder: order++,
    });
  }
  if (q.discountCents > 0) {
    rows.push({ id: newId(), jobId: job.id, parentId: null, kind: "ITEM", name: "Discount", description: null, costType: "OTHER", quantity: 1, unit: null, unitCostCents: 0, unitPriceCents: -q.discountCents, taxable: false, productId: null, quoteItemId: null, sortOrder: order++ });
  }
  // Every row has every column (a multi-row insert takes its columns from the first row).
  if (rows.length) await db`insert into ops.budget_items ${db(rows)}`;
  return { id: job.id, number: job.number, created: true };
}

const opt = (n = 200) => z.string().trim().max(n).nullish().transform((v) => v || null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")).transform((v) => v || null);
export const JobSchema = z.object({
  name: z.string().trim().min(1).max(200),
  status: z.enum(["PLANNING", "IN_PROGRESS", "ON_HOLD", "COMPLETE", "CANCELLED"]).default("PLANNING"),
  customerId: z.string().max(60).nullish().or(z.literal("")).transform((v) => v || null),
  managerId: z.string().max(60).nullish().or(z.literal("")).transform((v) => v || null),
  campusId: z.string().max(60).nullish().or(z.literal("")).transform((v) => v || null),
  siteLine1: opt(), siteLine2: opt(), siteCity: opt(100), siteState: opt(50), sitePostalCode: opt(20),
  startDate: date, endDate: date, notes: opt(20_000),
});

/** A job made by hand; with `groups`, it starts with those cost groups (empty). */
export async function createJob(input: z.infer<typeof JobSchema>, userId: string, groups: boolean) {
  const avl = await getAvl();
  return sql.begin(async (tx) => {
    const [job] = await tx`insert into ops.jobs ${tx({ ...input, number: await nextJobNumber(tx, avl.jobPrefix), createdById: userId })} returning id, number`;
    if (groups) {
      await tx`insert into ops.budget_items ${tx(DEFAULT_COST_GROUPS.map((name, i) => ({ id: newId(), jobId: job.id, kind: "GROUP", name, costType: "OTHER", quantity: 0, sortOrder: i })))}`;
    }
    return job as { id: string; number: string };
  });
}

const money = z.number().int().min(-1_000_000_000).max(1_000_000_000);
export const BudgetSchema = z.array(z.object({
  id: z.string().min(1).max(40),
  parentId: z.string().max(40).nullable(),
  kind: z.enum(["GROUP", "ITEM"]),
  name: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullish().transform((v) => v || null),
  costType: z.enum(["MATERIAL", "LABOR", "SUBCONTRACT", "OTHER"]),
  quantity: z.number().min(-1_000_000).max(1_000_000),
  unit: z.string().trim().max(20).nullish().transform((v) => v || null),
  unitCostCents: money, unitPriceCents: money,
  taxable: z.boolean(),
  productId: z.string().max(60).nullish(),
}).strict()).max(3000);

/**
 * Save the whole budget: existing items keep their ids (later documents point at them), new ones
 * (ids starting "new") get theirs, and items left out are removed.
 */
export async function saveBudget(jobId: string, items: z.infer<typeof BudgetSchema>) {
  return sql.begin(async (tx) => {
    const [j] = await tx`select id from ops.jobs where id = ${jobId} for update`;
    if (!j) throw new HttpError(404, "Job not found");
    const current = await tx`select id, quote_item_id from ops.budget_items where job_id = ${jobId}`;
    const mine = new Map(current.map((r) => [r.id as string, r.quoteItemId as string | null]));
    const ids = new Map<string, string>();
    for (const it of items) {
      if (ids.has(it.id)) throw new HttpError(422, "The budget has the same line twice.");
      if (it.id.startsWith("new")) ids.set(it.id, newId());
      else if (mine.has(it.id)) ids.set(it.id, it.id);
      else throw new HttpError(422, "A budget line belongs to another job.");
    }
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const it of items) {
      // A parent must be a group in this budget, and following parents must never come back round.
      const seen = new Set<string>([it.id]);
      for (let p = it.parentId; p; p = byId.get(p)?.parentId ?? null) {
        const parent = byId.get(p);
        if (!parent || parent.kind !== "GROUP") throw new HttpError(422, `“${it.name}” is under something that isn't a cost group.`);
        if (seen.has(p)) throw new HttpError(422, "Cost groups can't be inside themselves.");
        seen.add(p);
      }
    }
    const keep = [...ids.values()];
    await tx`delete from ops.budget_items where job_id = ${jobId} ${keep.length ? tx`and id <> all(${keep})` : tx``}`;
    if (items.length) {
      const rows = items.map((it, i) => ({
        id: ids.get(it.id)!, jobId, parentId: it.parentId ? ids.get(it.parentId)! : null, kind: it.kind, name: it.name, description: it.description,
        costType: it.costType, quantity: it.kind === "GROUP" ? 0 : it.quantity, unit: it.unit, unitCostCents: it.kind === "GROUP" ? 0 : it.unitCostCents,
        unitPriceCents: it.kind === "GROUP" ? 0 : it.unitPriceCents, taxable: it.taxable, productId: it.productId ?? null,
        quoteItemId: mine.get(ids.get(it.id)!) ?? null, sortOrder: i,
      }));
      await tx`insert into ops.budget_items ${tx(rows)} on conflict (id) do update set
        parent_id = excluded.parent_id, kind = excluded.kind, name = excluded.name, description = excluded.description, cost_type = excluded.cost_type,
        quantity = excluded.quantity, unit = excluded.unit, unit_cost_cents = excluded.unit_cost_cents, unit_price_cents = excluded.unit_price_cents,
        taxable = excluded.taxable, product_id = excluded.product_id, sort_order = excluded.sort_order`;
    }
    await tx`update ops.jobs set updated_at = now() where id = ${jobId}`;
    const budget = await budgetOf(jobId, tx);
    return { budget, total: budgetTotals(budget).total };
  });
}
