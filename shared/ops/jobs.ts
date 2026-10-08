/**
 * Sundays AVL jobs: the record everything after the sale hangs off, and its budget.
 *
 * The budget is a tree of cost groups (Audio, Video, Labor…) holding cost items. Money is whole
 * cents; quantities may have decimals (2.5 hours). Totals are always worked out here, never stored,
 * so the job page, the list and the server agree.
 */

import type { AvlBusiness, PublicQuote } from "./types";

export type JobStatus = "PLANNING" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETE" | "CANCELLED";
export const JOB_STATUSES: { id: JobStatus; label: string }[] = [
  { id: "PLANNING", label: "Planning" },
  { id: "IN_PROGRESS", label: "In progress" },
  { id: "ON_HOLD", label: "On hold" },
  { id: "COMPLETE", label: "Complete" },
  { id: "CANCELLED", label: "Cancelled" },
];
export const jobStatusLabel = (s: JobStatus) => JOB_STATUSES.find((x) => x.id === s)?.label ?? s;

export type CostType = "MATERIAL" | "LABOR" | "SUBCONTRACT" | "OTHER";
export const COST_TYPES: { id: CostType; label: string }[] = [
  { id: "MATERIAL", label: "Materials" },
  { id: "LABOR", label: "Labor" },
  { id: "SUBCONTRACT", label: "Subcontract" },
  { id: "OTHER", label: "Other" },
];

/** Integrator: sells to clients. Church team: runs its own projects (no proposals, clients or prices to crews). */
export type BusinessType = "INTEGRATOR" | "CHURCH";

/** The cost groups a new job (or a proposal section with no name) starts from. */
export const DEFAULT_COST_GROUPS = ["Design & engineering", "Audio", "Video", "Lighting", "Control", "Infrastructure", "Labor", "Programming & commissioning", "Training & closeout"];

export interface BudgetItem {
  id: string;
  parentId: string | null;
  kind: "GROUP" | "ITEM";
  name: string;
  description: string | null;
  costType: CostType;
  quantity: number;
  unit: string | null;
  unitCostCents: number;
  unitPriceCents: number;
  taxable: boolean;
  productId: string | null;
  quoteItemId: string | null;
  sortOrder: number;
}

export interface Money { costCents: number; priceCents: number; profitCents: number; marginBps: number }

const round = (n: number) => Math.round(n);
export function itemMoney(i: Pick<BudgetItem, "quantity" | "unitCostCents" | "unitPriceCents">): Money {
  const costCents = round(i.quantity * i.unitCostCents);
  const priceCents = round(i.quantity * i.unitPriceCents);
  return withMargin(costCents, priceCents);
}
function withMargin(costCents: number, priceCents: number): Money {
  const profitCents = priceCents - costCents;
  return { costCents, priceCents, profitCents, marginBps: priceCents > 0 ? Math.round((profitCents / priceCents) * 10_000) : 0 };
}

/** Totals for every group (its items and sub-groups) and for the whole budget. */
export function budgetTotals(items: BudgetItem[]): { byId: Map<string, Money>; total: Money } {
  const kids = new Map<string | null, BudgetItem[]>();
  for (const i of items) kids.set(i.parentId, [...(kids.get(i.parentId) ?? []), i]);
  const byId = new Map<string, Money>();
  const sum = (parent: string | null, seen = new Set<string>()): Money => {
    let cost = 0, price = 0;
    for (const i of kids.get(parent) ?? []) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      const m = i.kind === "GROUP" ? sum(i.id, seen) : itemMoney(i);
      byId.set(i.id, m);
      cost += m.costCents; price += m.priceCents;
    }
    return withMargin(cost, price);
  };
  return { byId, total: sum(null) };
}

/** The budget in display order: each group followed by its children, with their depth. */
export function budgetRows(items: BudgetItem[]): { item: BudgetItem; depth: number }[] {
  const kids = new Map<string | null, BudgetItem[]>();
  for (const i of items) kids.set(i.parentId, [...(kids.get(i.parentId) ?? []), i]);
  for (const l of kids.values()) l.sort((a, b) => a.sortOrder - b.sortOrder);
  const out: { item: BudgetItem; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const i of kids.get(parent) ?? []) { out.push({ item: i, depth }); if (i.kind === "GROUP" && depth < 6) walk(i.id, depth + 1); }
  };
  walk(null, 0);
  return out;
}

export interface JobRow {
  id: string; number: string; name: string; status: JobStatus;
  customer: { id: string; name: string } | null;
  quote: { id: string; number: string } | null;
  manager: { id: string; name: string } | null;
  siteLine1: string | null; siteCity: string | null; siteState: string | null;
  startDate: string | null; endDate: string | null;
  priceCents: number; costCents: number; profitCents: number; marginBps: number;
  updatedAt: string;
}

export interface JobDetail extends JobRow {
  campusId: string | null; managerId: string | null; customerId: string | null;
  siteLine2: string | null; sitePostalCode: string | null; notes: string | null;
  createdAt: string; createdBy: string | null;
}

export interface JobDocument {
  kind: "PROPOSAL";
  id: string; number: string; title: string; status: string; totalCents: number; date: string | null;
  signature: { signerName: string; signerEmail: string; signerTitle: string | null; signedAt: string; totalCents: number } | null;
}

export interface JobPage {
  job: JobDetail;
  budget: BudgetItem[];
  documents: JobDocument[];
  customers: { id: string; name: string }[];
  people: { id: string; name: string }[];
  businessType: BusinessType;
  canEdit: boolean;
}

export interface JobsList {
  jobs: JobRow[];
  counts: Record<JobStatus, number>;
  customers: { id: string; name: string }[];
  businessType: BusinessType;
}

/** The page a client opens from the proposal link: what they see and sign (no cost, margin or internal notes). */
export interface ClientProposalPage {
  quote: PublicQuote;
  org: AvlBusiness;
  logo: string | null;
  /** Past its "valid until" date: it can't be signed any more. */
  expired: boolean;
  /** SENT and not expired: the client can sign, ask for changes or decline. */
  canAnswer: boolean;
  signature: { signerName: string; signerTitle: string | null; signedAt: string; totalCents: number } | null;
  /** The last thing the client said (changes asked for, or why they declined). */
  answer: { kind: "CHANGES" | "DECLINED"; note: string | null; at: string } | null;
}
