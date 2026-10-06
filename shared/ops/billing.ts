/**
 * Modules, plans and what an organization pays. Pure: used by the ops function (to gate features
 * and write invoices) and by the screens (pricing, plan & billing, the admin console).
 */
import type { RequestKind } from "./workflow";

export type ModuleKey = "technology" | "supplies" | "facilities" | "campuses" | "branding" | "avl";
export const MODULE_KEYS: ModuleKey[] = ["technology", "supplies", "facilities", "campuses", "branding", "avl"];

/** Which module each kind of request belongs to ("Other" is always included). */
export const KIND_MODULE: Record<RequestKind, ModuleKey | null> = { TECHNOLOGY: "technology", SUPPLY: "supplies", MAINTENANCE: "facilities", OTHER: null };
export const kindAllowed = (kind: RequestKind, modules: readonly string[]) => { const m = KIND_MODULE[kind]; return !m || modules.includes(m); };

export type OrgType = "CHURCH" | "NONPROFIT" | "SCHOOL" | "BUSINESS";
export const ORG_TYPES: { key: OrgType; label: string }[] = [
  { key: "CHURCH", label: "Church" }, { key: "NONPROFIT", label: "Ministry or nonprofit" }, { key: "SCHOOL", label: "School" }, { key: "BUSINESS", label: "Business" },
];
export type OrgStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";
export const ORG_STATUS_LABEL: Record<OrgStatus, string> = { TRIAL: "Trial", ACTIVE: "Active", PAST_DUE: "Past due", SUSPENDED: "Suspended", CANCELLED: "Cancelled" };
export const BLOCKED_STATUSES: OrgStatus[] = ["SUSPENDED", "CANCELLED"];
export type Interval = "MONTHLY" | "YEARLY";

export interface ModuleDef { key: ModuleKey; name: string; description: string | null; priceMonthlyCents: number; priceYearlyCents: number; sortOrder: number; active: boolean }
export interface PlanDef {
  id: string; name: string; tagline: string | null; priceMonthlyCents: number; priceYearlyCents: number; modules: string[];
  maxUsers: number | null; maxCampuses: number | null; trialDays: number; public: boolean; active: boolean; highlight: boolean; sortOrder: number;
}
export interface OrgBilling {
  orgType: OrgType; planId: string | null; billingInterval: Interval; fullLicense: boolean; moduleOverrides: Record<string, boolean>;
  churchDiscount: boolean; discountBps: number; discountCents: number; discountEndsAt: string | Date | null;
}

/** Modules an organization has: its plan's, plus add-ons, minus anything turned off. A full license has all of them. */
export function effectiveModules(org: Pick<OrgBilling, "fullLicense" | "moduleOverrides">, plan: Pick<PlanDef, "modules"> | null | undefined): ModuleKey[] {
  if (org.fullLicense) return [...MODULE_KEYS];
  const set = new Set<string>(plan?.modules ?? []);
  for (const [k, on] of Object.entries(org.moduleOverrides ?? {})) on ? set.add(k) : set.delete(k);
  return MODULE_KEYS.filter((k) => set.has(k));
}

export interface BillLine { label: string; amountCents: number; kind: "plan" | "addon" | "discount" | "license" }
export interface Bill { interval: Interval; lines: BillLine[]; subtotalCents: number; discountCents: number; totalCents: number }

const activeDiscount = (o: OrgBilling, now: Date) => !o.discountEndsAt || new Date(o.discountEndsAt) > now;

/** What the organization owes per billing period. */
export function computeBill(org: OrgBilling, plan: PlanDef | null | undefined, modules: ModuleDef[], churchDiscountBps: number, now = new Date()): Bill {
  const interval = org.billingInterval;
  const price = (m: { priceMonthlyCents: number; priceYearlyCents: number }) => (interval === "YEARLY" ? m.priceYearlyCents : m.priceMonthlyCents);
  if (org.fullLicense) return { interval, lines: [{ label: "Full license", amountCents: 0, kind: "license" }], subtotalCents: 0, discountCents: 0, totalCents: 0 };
  const lines: BillLine[] = [];
  if (plan) lines.push({ label: `${plan.name} plan`, amountCents: price(plan), kind: "plan" });
  const have = effectiveModules(org, plan);
  for (const k of have) {
    if (plan?.modules.includes(k)) continue;
    const m = modules.find((x) => x.key === k);
    if (m) lines.push({ label: `${m.name} add-on`, amountCents: price(m), kind: "addon" });
  }
  const subtotal = lines.reduce((s, l) => s + l.amountCents, 0);
  let running = subtotal;
  const discounts: BillLine[] = [];
  if (org.orgType === "CHURCH" && org.churchDiscount && churchDiscountBps > 0 && running > 0) {
    const d = Math.round((running * churchDiscountBps) / 10_000);
    discounts.push({ label: `Church discount (${churchDiscountBps / 100}%)`, amountCents: -d, kind: "discount" });
    running -= d;
  }
  if (activeDiscount(org, now)) {
    if (org.discountBps > 0 && running > 0) {
      const d = Math.round((running * org.discountBps) / 10_000);
      discounts.push({ label: `Discount (${org.discountBps / 100}%)`, amountCents: -d, kind: "discount" });
      running -= d;
    }
    if (org.discountCents > 0 && running > 0) {
      const d = Math.min(org.discountCents, running);
      discounts.push({ label: "Discount", amountCents: -d, kind: "discount" });
      running -= d;
    }
  }
  return { interval, lines: [...lines, ...discounts], subtotalCents: subtotal, discountCents: subtotal - running, totalCents: running };
}

export const fmtPrice = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 ? 2 : 0 });
