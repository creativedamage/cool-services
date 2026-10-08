/**
 * AVL estimating: labor rates, markup rules and kits (see lib/estimating.ts for the rules).
 */
import { z } from "zod";
import { marginFor, type KitDetail, type KitItem, type KitLine, type KitRow, type LaborRate, type MarkupRule } from "./lib/estimating.ts";
import { priceForMargin } from "./lib/math.ts";
import { getAvl, HttpError, sql, type Tx } from "./db.ts";

type Db = typeof sql | Tx;
const opt = (n = 200) => z.string().trim().max(n).nullish().transform((v) => v || null);
const cents = z.number().int().min(0).max(1_000_000_000);
const iso = (d: unknown) => new Date(d as string).toISOString();

/* ───────────── Labor rates & markup rules ───────────── */

export async function laborRates(activeOnly = false, db: Db = sql): Promise<LaborRate[]> {
  const rows = await db`select * from ops.labor_rates ${activeOnly ? db`where active` : db``} order by sort_order, name`;
  return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, unit: r.unit, costCents: r.costCents, priceCents: r.priceCents, taxable: r.taxable, active: r.active }));
}
export async function markupRules(db: Db = sql): Promise<MarkupRule[]> {
  const rows = await db`select * from ops.markup_rules order by sort_order, created_at`;
  return rows.map((r) => ({ id: r.id, manufacturer: r.manufacturer, category: r.category, vendorId: r.vendorId, marginBps: r.marginBps }));
}

export const LaborRatesSchema = z.array(z.object({
  id: z.string().max(40), name: z.string().trim().min(1, "Name each labor rate.").max(120), description: opt(500), unit: z.string().trim().min(1).max(20).default("hr"),
  costCents: cents, priceCents: cents, taxable: z.boolean().default(false), active: z.boolean().default(true),
})).max(100);
/** Save the whole list: existing rates keep their ids (kits point at them); missing ones are retired, not deleted. */
export async function saveLaborRates(input: z.infer<typeof LaborRatesSchema>) {
  return sql.begin(async (tx) => {
    const have = new Set((await tx`select id from ops.labor_rates`).map((r) => r.id as string));
    const keep: string[] = [];
    for (const [i, r] of input.entries()) {
      const data = { name: r.name, description: r.description, unit: r.unit, costCents: r.costCents, priceCents: r.priceCents, taxable: r.taxable, active: r.active, sortOrder: i, updatedAt: new Date() };
      if (have.has(r.id)) { await tx`update ops.labor_rates set ${tx(data)} where id = ${r.id}`; keep.push(r.id); }
      else { const [row] = await tx`insert into ops.labor_rates ${tx(data)} returning id`; keep.push(row.id); }
    }
    // Kits may still use a removed rate: it's switched off rather than deleted.
    await tx`update ops.labor_rates set active = false, updated_at = now() where ${keep.length ? tx`id <> all(${keep})` : tx`true`}`;
    return laborRates(false, tx);
  });
}

export const MarkupRulesSchema = z.array(z.object({
  manufacturer: opt(120), category: opt(120), vendorId: z.string().max(60).nullish().or(z.literal("")).transform((v) => v || null),
  marginBps: z.number().int().min(0).max(9900),
}).refine((r) => r.manufacturer || r.category || r.vendorId, "Each rule needs a manufacturer, category or vendor.")).max(200);
export async function saveMarkupRules(input: z.infer<typeof MarkupRulesSchema>) {
  return sql.begin(async (tx) => {
    await tx`delete from ops.markup_rules`;
    if (input.length) await tx`insert into ops.markup_rules ${tx(input.map((r, i) => ({ ...r, sortOrder: i })))}`;
    return markupRules(tx);
  });
}

/* ───────────── Kits ───────────── */

/** A kit's items, with today's cost and price for its products (by markup rule) and labor (by rate). */
async function pricedItems(assemblyId: string, db: Db = sql): Promise<KitItem[]> {
  const [rows, rules, biz] = await Promise.all([
    db`select a.*, p.sku, p.cost_cents as p_cost, p.manufacturer, p.category, p.vendor_id, p.active as p_active,
         l.cost_cents as l_cost, l.price_cents as l_price, l.unit as l_unit
       from ops.assembly_items a
       left join ops.products p on p.id = a.product_id
       left join ops.labor_rates l on l.id = a.labor_rate_id
       where a.assembly_id = ${assemblyId} order by a.sort_order, a.id`,
    markupRules(db), getAvl(db),
  ]);
  return rows.map((r) => {
    let live: KitItem["live"] = null;
    if (r.kind === "PRODUCT") {
      const missing = r.pCost == null || r.pActive === false;
      const cost = missing ? r.unitCostCents : r.pCost;
      live = { sku: r.sku ?? null, unitCostCents: cost, unitPriceCents: priceForMargin(cost, marginFor({ manufacturer: r.manufacturer, category: r.category, vendorId: r.vendorId }, rules, biz.defaultMarginBps).marginBps), missing };
    } else if (r.kind === "LABOR") {
      const missing = r.lCost == null;
      live = { sku: null, unitCostCents: missing ? r.unitCostCents : r.lCost, unitPriceCents: missing ? (r.unitPriceCents ?? 0) : r.lPrice, missing };
    }
    return {
      id: r.id, kind: r.kind, productId: r.productId, laborRateId: r.laborRateId, name: r.name, description: r.description, quantity: r.quantity,
      unitCostCents: r.unitCostCents, unitPriceCents: r.unitPriceCents, taxable: r.taxable, live,
    };
  });
}
/** What a kit line costs and sells for today (a price set on the line wins over the price list). */
export const linePrice = (i: KitItem) => ({
  cost: i.live ? i.live.unitCostCents : i.unitCostCents,
  price: i.unitPriceCents ?? (i.live ? i.live.unitPriceCents : 0),
});

export async function kitRows(): Promise<KitRow[]> {
  const kits = await sql`select * from ops.assemblies order by active desc, name`;
  return Promise.all(kits.map(async (k) => {
    const items = await pricedItems(k.id);
    let cost = 0, price = 0;
    for (const i of items) { const p = linePrice(i); cost += p.cost * i.quantity; price += p.price * i.quantity; }
    return { id: k.id, name: k.name, description: k.description, section: k.section, active: k.active, items: items.length, costCents: cost, priceCents: price, updatedAt: iso(k.updatedAt) };
  }));
}

export async function kitDetail(id: string): Promise<KitDetail> {
  const [k] = await sql`select * from ops.assemblies where id = ${id}`;
  if (!k) throw new HttpError(404, "Kit not found");
  const items = await pricedItems(id);
  let cost = 0, price = 0;
  for (const i of items) { const p = linePrice(i); cost += p.cost * i.quantity; price += p.price * i.quantity; }
  return { id: k.id, name: k.name, description: k.description, section: k.section, active: k.active, costCents: cost, priceCents: price, updatedAt: iso(k.updatedAt), items };
}

export const KitSchema = z.object({
  name: z.string().trim().min(1, "Name the kit.").max(200), description: opt(2000), section: opt(80), active: z.boolean().default(true),
  items: z.array(z.object({
    kind: z.enum(["PRODUCT", "LABOR", "CUSTOM"]),
    productId: z.string().max(60).nullish().transform((v) => v || null), laborRateId: z.string().max(60).nullish().transform((v) => v || null),
    name: z.string().trim().min(1).max(300), description: opt(5000), quantity: z.number().int().min(1).max(100_000),
    unitCostCents: cents.default(0), unitPriceCents: cents.nullish().transform((v) => v ?? null), taxable: z.boolean().default(true),
  }).refine((i) => i.kind !== "PRODUCT" || i.productId, "Pick the product.").refine((i) => i.kind !== "LABOR" || i.laborRateId, "Pick the labor rate.")).max(300),
});

export async function saveKit(id: string | null, input: z.infer<typeof KitSchema>, userId: string) {
  return sql.begin(async (tx) => {
    const { items, ...kit } = input;
    let kid = id;
    if (kid) {
      const [k] = await tx`update ops.assemblies set ${tx({ ...kit, updatedAt: new Date() })} where id = ${kid} returning id`;
      if (!k) throw new HttpError(404, "Kit not found");
      await tx`delete from ops.assembly_items where assembly_id = ${kid}`;
    } else {
      [{ id: kid }] = await tx`insert into ops.assemblies ${tx({ ...kit, createdById: userId })} returning id`;
    }
    if (items.length) {
      await tx`insert into ops.assembly_items ${tx(items.map((i, n) => ({
        assemblyId: kid, kind: i.kind, productId: i.kind === "PRODUCT" ? i.productId : null, laborRateId: i.kind === "LABOR" ? i.laborRateId : null,
        name: i.name, description: i.description, quantity: i.quantity, unitCostCents: i.unitCostCents, unitPriceCents: i.unitPriceCents, taxable: i.taxable, sortOrder: n,
      })))}`;
    }
    return kid!;
  });
}

/** A kit's lines, priced today, ready to go into a proposal or a job budget. */
export async function kitLines(id: string): Promise<{ kit: { id: string; name: string; section: string | null }; lines: KitLine[] }> {
  const k = await kitDetail(id);
  return {
    kit: { id: k.id, name: k.name, section: k.section },
    lines: k.items.map((i) => {
      const p = linePrice(i);
      return {
        productId: i.kind === "PRODUCT" && !i.live?.missing ? i.productId : null, isCustom: !(i.kind === "PRODUCT" && !i.live?.missing),
        sku: i.live?.sku ?? null, name: i.name, description: i.description, quantity: i.quantity, unitCostCents: p.cost, unitPriceCents: p.price,
        taxable: i.taxable, labor: i.kind === "LABOR",
      };
    }),
  };
}
