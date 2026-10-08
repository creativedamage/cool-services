/**
 * Sundays AVL estimating: labor rates, markup rules, kits, and options on a proposal.
 *
 * Options: a proposal line can belong to an option group.
 *  · Optional add-on: lines with a group and no choice. The client ticks the whole group in or out.
 *  · Alternates: lines with a group and a choice ("Good", "Better"…). The client picks exactly one
 *    choice in the group; a choice may be several lines.
 * `selected` says what's in the total (see math.ts computeTotals).
 */

export interface LaborRate { id: string; name: string; description: string | null; unit: string; costCents: number; priceCents: number; taxable: boolean; active: boolean }

export interface MarkupRule { id: string; manufacturer: string | null; category: string | null; vendorId: string | null; marginBps: number }

/** What a product needs to find its rule. */
export interface PricedProduct { manufacturer: string | null; category: string | null; vendorId: string | null }

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The margin for a product: the most specific rule that matches it (a rule naming two things beats
 * one naming one; ties go to the first in the list), else the business default.
 */
export function marginFor(p: PricedProduct, rules: MarkupRule[], defaultBps: number): { marginBps: number; rule: MarkupRule | null } {
  let best: MarkupRule | null = null, bestScore = 0;
  for (const r of rules) {
    const parts = [r.manufacturer && [r.manufacturer, p.manufacturer], r.category && [r.category, p.category], r.vendorId && [r.vendorId, p.vendorId]].filter(Boolean) as [string, string | null][];
    if (!parts.length || !parts.every(([want, have]) => same(want, have))) continue;
    if (parts.length > bestScore) { best = r; bestScore = parts.length; }
  }
  return { marginBps: best ? best.marginBps : defaultBps, rule: best };
}
export const describeRule = (r: MarkupRule, vendorName?: string | null) =>
  [r.manufacturer, r.category, r.vendorId ? (vendorName ?? "vendor") : null].filter(Boolean).join(" · ") || "Everything";

export type KitItemKind = "PRODUCT" | "LABOR" | "CUSTOM";
export interface KitItem {
  id: string; kind: KitItemKind; productId: string | null; laborRateId: string | null;
  name: string; description: string | null; quantity: number;
  unitCostCents: number; unitPriceCents: number | null; taxable: boolean;
  /** For PRODUCT / LABOR: today's cost and price from the price list / rate (filled by the server). */
  live?: { sku: string | null; unitCostCents: number; unitPriceCents: number; missing: boolean } | null;
}
export interface KitRow { id: string; name: string; description: string | null; section: string | null; active: boolean; items: number; costCents: number; priceCents: number; updatedAt: string }
export interface KitDetail extends Omit<KitRow, "items"> { items: KitItem[] }

/** A kit's lines as they go into a proposal or budget, priced today. */
export interface KitLine {
  productId: string | null; isCustom: boolean; sku: string | null; name: string; description: string | null;
  quantity: number; unitCostCents: number; unitPriceCents: number; taxable: boolean; labor: boolean;
}

export interface PricingSetup { laborRates: LaborRate[]; markupRules: MarkupRule[]; defaultMarginBps: number; vendors: { id: string; name: string }[] }

/* ───────────── Options ───────────── */

export interface OptionLine { optionGroup?: string | null; optionChoice?: string | null; selected?: boolean }
export const isOption = (i: OptionLine) => !!i.optionGroup?.trim();
export const isAlternate = (i: OptionLine) => isOption(i) && !!i.optionChoice?.trim();

/**
 * Make options consistent: every line of an optional add-on in or out together (as its first line),
 * and exactly one choice selected in each alternates group (the first selected one, else the first).
 */
export function normalizeOptions<T extends OptionLine>(items: T[]): T[] {
  const addOn = new Map<string, boolean>(), pick = new Map<string, string>();
  for (const i of items) {
    if (!isOption(i)) continue;
    const g = i.optionGroup!.trim();
    if (isAlternate(i)) { if (!pick.has(g) && i.selected !== false) pick.set(g, i.optionChoice!.trim()); }
    else if (!addOn.has(g)) addOn.set(g, i.selected !== false);
  }
  for (const i of items) if (isAlternate(i) && !pick.has(i.optionGroup!.trim())) pick.set(i.optionGroup!.trim(), i.optionChoice!.trim());
  return items.map((i) => {
    if (!isOption(i)) return { ...i, optionGroup: null, optionChoice: null, selected: true };
    const g = i.optionGroup!.trim();
    if (isAlternate(i)) return { ...i, optionGroup: g, optionChoice: i.optionChoice!.trim(), selected: pick.get(g) === i.optionChoice!.trim() };
    return { ...i, optionGroup: g, optionChoice: null, selected: addOn.get(g) ?? true };
  });
}

export interface OptionGroup<T> { group: string; kind: "ADD_ON" | "ALTERNATES"; choices: { choice: string | null; items: T[]; selected: boolean }[] }
/** The option groups on a proposal, in the order they first appear. */
export function optionGroups<T extends OptionLine>(items: T[]): OptionGroup<T>[] {
  const out: OptionGroup<T>[] = [];
  for (const i of items) {
    if (!isOption(i)) continue;
    const g = i.optionGroup!.trim();
    let grp = out.find((x) => x.group === g);
    if (!grp) { grp = { group: g, kind: isAlternate(i) ? "ALTERNATES" : "ADD_ON", choices: [] }; out.push(grp); }
    const c = isAlternate(i) ? i.optionChoice!.trim() : null;
    let ch = grp.choices.find((x) => x.choice === c);
    if (!ch) { ch = { choice: c, items: [], selected: i.selected !== false }; grp.choices.push(ch); }
    ch.items.push(i);
  }
  return out;
}

/** The client's picks: an add-on group → in or out; an alternates group → the chosen choice. */
export type Selections = Record<string, boolean | string>;
export function applySelections<T extends OptionLine>(items: T[], sel: Selections): T[] {
  return normalizeOptions(items.map((i) => {
    if (!isOption(i)) return i;
    const v = sel[i.optionGroup!.trim()];
    if (v === undefined) return i;
    return { ...i, selected: isAlternate(i) ? v === i.optionChoice!.trim() : v === true };
  }));
}
export function selectionsOf<T extends OptionLine>(items: T[]): Selections {
  const s: Selections = {};
  for (const g of optionGroups(items)) s[g.group] = g.kind === "ADD_ON" ? g.choices[0].selected : (g.choices.find((c) => c.selected)?.choice ?? g.choices[0].choice!);
  return s;
}

/* ───────────── Versions ───────────── */

export interface QuoteVersionRow { version: number; sentAt: string; sentBy: string | null; totalCents: number }
