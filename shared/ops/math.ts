/** All money is integer cents. All rates are basis points (1% = 100). */

export interface LineInput {
  quantity: number;
  unitCostCents: number;
  unitPriceCents: number;
  taxable: boolean;
  /** An option the client hasn't chosen (estimating.ts) isn't in the total. */
  selected?: boolean;
}

export interface QuoteTotals {
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
  costCents: number;
  grossProfitCents: number;
  marginBps: number; // profit / revenue (pre-tax, post-discount)
  markupBps: number; // profit / cost
  depositCents: number;
}

/** Banker-safe round-half-up for positive values. */
const round = (n: number) => Math.round(n);

export function lineTotals(l: LineInput) {
  const priceCents = l.quantity * l.unitPriceCents;
  const costCents = l.quantity * l.unitCostCents;
  const profitCents = priceCents - costCents;
  return {
    priceCents,
    costCents,
    profitCents,
    marginBps: priceCents > 0 ? round((profitCents / priceCents) * 10_000) : 0,
  };
}

export function computeTotals(
  lines: LineInput[],
  opts: { taxBps: number; discountCents: number; depositBps: number; taxExempt?: boolean },
): QuoteTotals {
  let subtotal = 0;
  let taxableBase = 0;
  let cost = 0;
  for (const l of lines) {
    if (l.selected === false) continue;
    const t = lineTotals(l);
    subtotal += t.priceCents;
    cost += t.costCents;
    if (l.taxable) taxableBase += t.priceCents;
  }
  const discount = Math.min(Math.max(opts.discountCents, 0), subtotal);
  // Discount is applied pro-rata across taxable/non-taxable lines.
  const taxableAfterDiscount =
    subtotal > 0 ? round(taxableBase - discount * (taxableBase / subtotal)) : 0;
  const tax = opts.taxExempt ? 0 : round((taxableAfterDiscount * opts.taxBps) / 10_000);
  const revenue = subtotal - discount;
  const total = revenue + tax;
  const profit = revenue - cost;
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    taxableCents: taxableAfterDiscount,
    taxCents: tax,
    totalCents: total,
    costCents: cost,
    grossProfitCents: profit,
    marginBps: revenue > 0 ? round((profit / revenue) * 10_000) : 0,
    markupBps: cost > 0 ? round((profit / cost) * 10_000) : 0,
    depositCents: round((total * opts.depositBps) / 10_000),
  };
}

/** Sell price that achieves a target margin: price = cost / (1 - margin). */
export function priceForMargin(unitCostCents: number, marginBps: number): number {
  if (marginBps >= 10_000) throw new Error("Margin must be below 100%");
  return round(unitCostCents / (1 - marginBps / 10_000));
}

export const fmtMoney = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const fmtPct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

/** "$1,234.50" | "1234.5" | "(12.00)" -> cents. Returns null if unparseable. */
export function parseMoneyToCents(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? round(raw * 100) : null;
  let s = String(raw).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()$,\s-]/g, "").replace(/USD/i, "");
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const cents = round(parseFloat(s) * 100);
  return negative ? -cents : cents;
}
