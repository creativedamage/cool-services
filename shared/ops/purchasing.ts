/**
 * Sundays AVL purchasing and job costing: purchase orders, receiving, work orders, vendor bills,
 * change orders, and how the job's budget compares with what's committed and spent.
 *
 *   budgeted  = the budget item's cost (quantity × unit cost)
 *   committed = approved purchase orders + sent work orders, on that item
 *   actual    = vendor bills on that item (+ logged time, spread over the labor items)
 *   projected = actual once the item is marked final, else the largest of the three
 *
 * Group and job figures are sums of their items. Money is whole cents.
 */
import type { BudgetItem } from "./jobs";

/* ───────────── Purchase orders ───────────── */

export type PoStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ORDERED" | "PARTIAL" | "RECEIVED" | "CANCELLED";
export const PO_STATUSES: { id: PoStatus; label: string; tone: "muted" | "warn" | "accent" | "ok" | "bad" }[] = [
  { id: "DRAFT", label: "Draft", tone: "muted" },
  { id: "PENDING_APPROVAL", label: "Waiting for approval", tone: "warn" },
  { id: "APPROVED", label: "Approved", tone: "accent" },
  { id: "ORDERED", label: "Ordered", tone: "accent" },
  { id: "PARTIAL", label: "Partly received", tone: "warn" },
  { id: "RECEIVED", label: "Received", tone: "ok" },
  { id: "CANCELLED", label: "Cancelled", tone: "bad" },
];
export const poStatus = (s: PoStatus) => PO_STATUSES.find((x) => x.id === s) ?? PO_STATUSES[0];
/** From approval on, a PO's cost is committed to the job. */
export const PO_COMMITTED: PoStatus[] = ["APPROVED", "ORDERED", "PARTIAL", "RECEIVED"];
/** Lines, vendor and costs can change only before approval. */
export const poEditable = (s: PoStatus) => s === "DRAFT" || s === "PENDING_APPROVAL";
/** Receiving is for POs that have gone to the vendor. */
export const poReceivable = (s: PoStatus) => s === "ORDERED" || s === "PARTIAL" || s === "APPROVED";

export type PoEvent = "SUBMIT" | "APPROVE" | "REJECT" | "SEND" | "MARK_ORDERED" | "CANCEL" | "REOPEN";

export interface PoLine {
  id: string;
  budgetItemId: string | null;
  productId: string | null;
  sku: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitCostCents: number;
  receivedQty: number;
  /** Already on a vendor bill. */
  billedQty: number;
  sortOrder: number;
}

export interface PoReceipt { id: string; at: string; by: string | null; note: string | null; lines: { itemId: string; name: string; qty: number }[] }
export interface BillLink { id: string; billNumber: string | null; totalCents: number; status: BillStatus; billDate: string }

export interface PurchaseOrder {
  id: string;
  number: string;
  status: PoStatus;
  vendor: { id: string; name: string; repName: string | null; repEmail: string | null; accountNo: string | null } | null;
  job: { id: string; number: string; name: string } | null;
  lines: PoLine[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  expectedDate: string | null;
  shipTo: string | null;
  notes: string | null;
  rejectedNote: string | null;
  createdBy: string | null;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  sentAt: string | null;
  sentTo: string | null;
  orderedAt: string | null;
  /** The vendor's link to a printable copy. */
  vendorUrl: string | null;
  receipts: PoReceipt[];
  bills: BillLink[];
  billedCents: number;
}

export interface PoRow {
  id: string; number: string; status: PoStatus;
  vendor: { id: string; name: string } | null;
  job: { id: string; number: string; name: string } | null;
  totalCents: number; lines: number; receivedPct: number;
  expectedDate: string | null; createdAt: string; createdBy: string | null;
}

/** What a vendor sees from the PO link: no job budget, no internal notes. */
export interface VendorPoPage {
  po: Pick<PurchaseOrder, "number" | "status" | "subtotalCents" | "shippingCents" | "taxCents" | "totalCents" | "expectedDate" | "shipTo" | "notes" | "sentAt"> & {
    lines: Pick<PoLine, "sku" | "name" | "description" | "quantity" | "unit" | "unitCostCents">[];
    vendor: { name: string; accountNo: string | null } | null;
    jobRef: string | null;
  };
  business: { name: string; address: string | null; phone: string | null; email: string | null };
  logo: string | null;
}

export const poTotals = (lines: Pick<PoLine, "quantity" | "unitCostCents">[], shippingCents = 0, taxCents = 0) => {
  const subtotalCents = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitCostCents), 0);
  return { subtotalCents, totalCents: subtotalCents + shippingCents + taxCents };
};

/* ───────────── Work orders ───────────── */

export type WoStatus = "DRAFT" | "SENT" | "ACCEPTED" | "DONE" | "CANCELLED";
export const WO_STATUSES: { id: WoStatus; label: string; tone: "muted" | "warn" | "accent" | "ok" | "bad" }[] = [
  { id: "DRAFT", label: "Draft", tone: "muted" },
  { id: "SENT", label: "Sent", tone: "accent" },
  { id: "ACCEPTED", label: "Accepted", tone: "accent" },
  { id: "DONE", label: "Done", tone: "ok" },
  { id: "CANCELLED", label: "Cancelled", tone: "bad" },
];
export const woStatus = (s: WoStatus) => WO_STATUSES.find((x) => x.id === s) ?? WO_STATUSES[0];
export const WO_COMMITTED: WoStatus[] = ["SENT", "ACCEPTED", "DONE"];

export interface WoLine { id: string; budgetItemId: string | null; description: string; quantity: number; unit: string | null; unitCostCents: number; sortOrder: number }
export interface WorkOrder {
  id: string; number: string; title: string; status: WoStatus;
  job: { id: string; number: string; name: string };
  vendor: { id: string; name: string; repEmail: string | null } | null;
  assigneeName: string | null; assigneeEmail: string | null;
  scope: string | null; startDate: string | null; dueDate: string | null;
  lines: WoLine[]; totalCents: number;
  sentAt: string | null; sentTo: string | null; acceptedAt: string | null; acceptedBy: string | null; doneAt: string | null;
  createdBy: string | null; createdAt: string;
  publicUrl: string | null;
  bills: BillLink[]; billedCents: number;
}
export interface WoRow { id: string; number: string; title: string; status: WoStatus; who: string | null; job: { id: string; number: string; name: string }; totalCents: number; dueDate: string | null; createdAt: string }

/** What the installer sees from the work order link. */
export interface PublicWorkOrderPage {
  wo: Pick<WorkOrder, "number" | "title" | "status" | "scope" | "startDate" | "dueDate" | "totalCents" | "assigneeName" | "acceptedAt" | "acceptedBy"> & {
    lines: Pick<WoLine, "description" | "quantity" | "unit" | "unitCostCents">[];
    vendor: string | null;
    site: string | null;
    jobName: string;
  };
  business: { name: string; phone: string | null; email: string | null };
  logo: string | null;
  canAccept: boolean;
}

/* ───────────── Vendor bills ───────────── */

export type BillStatus = "OPEN" | "PAID" | "VOID";
export const BILL_STATUSES: { id: BillStatus; label: string; tone: "warn" | "ok" | "muted" }[] = [
  { id: "OPEN", label: "To pay", tone: "warn" },
  { id: "PAID", label: "Paid", tone: "ok" },
  { id: "VOID", label: "Void", tone: "muted" },
];
export const billStatus = (s: BillStatus) => BILL_STATUSES.find((x) => x.id === s) ?? BILL_STATUSES[0];

export interface BillLine { id: string; budgetItemId: string | null; poItemId: string | null; workOrderItemId: string | null; description: string; quantity: number; unitCostCents: number; sortOrder: number }
export interface VendorBill {
  id: string; billNumber: string | null; status: BillStatus;
  vendor: { id: string; name: string } | null;
  job: { id: string; number: string; name: string } | null;
  po: { id: string; number: string } | null;
  workOrder: { id: string; number: string } | null;
  billDate: string; dueDate: string | null; paidAt: string | null;
  lines: BillLine[]; otherCents: number; totalCents: number; notes: string | null;
  file: { id: string; name: string; url: string | null } | null;
  createdBy: string | null; createdAt: string;
}
export interface BillRow {
  id: string; billNumber: string | null; status: BillStatus;
  vendor: { id: string; name: string } | null; job: { id: string; number: string; name: string } | null;
  po: { id: string; number: string } | null;
  billDate: string; dueDate: string | null; totalCents: number; overdue: boolean;
}
export const billTotal = (lines: Pick<BillLine, "quantity" | "unitCostCents">[], otherCents = 0) =>
  lines.reduce((s, l) => s + Math.round(l.quantity * l.unitCostCents), 0) + otherCents;

/* ───────────── Change orders ───────────── */

export type CoStatus = "DRAFT" | "SENT" | "APPROVED" | "DECLINED" | "CANCELLED";
export const CO_STATUSES: { id: CoStatus; label: string; tone: "muted" | "warn" | "accent" | "ok" | "bad" }[] = [
  { id: "DRAFT", label: "Draft", tone: "muted" },
  { id: "SENT", label: "Waiting for the client", tone: "warn" },
  { id: "APPROVED", label: "Approved", tone: "ok" },
  { id: "DECLINED", label: "Declined", tone: "bad" },
  { id: "CANCELLED", label: "Cancelled", tone: "muted" },
];
export const coStatus = (s: CoStatus) => CO_STATUSES.find((x) => x.id === s) ?? CO_STATUSES[0];

export interface CoLine {
  id: string; groupName: string; name: string; description: string | null; costType: BudgetItem["costType"];
  quantity: number; unit: string | null; unitCostCents: number; unitPriceCents: number; taxable: boolean;
  productId: string | null; budgetItemId: string | null; sortOrder: number;
}
export interface CoTotals { subtotalCents: number; taxCents: number; totalCents: number; costCents: number; profitCents: number }
export function coTotals(lines: Pick<CoLine, "quantity" | "unitCostCents" | "unitPriceCents" | "taxable">[], taxBps: number): CoTotals {
  let sub = 0, taxable = 0, cost = 0;
  for (const l of lines) {
    const p = Math.round(l.quantity * l.unitPriceCents);
    sub += p; cost += Math.round(l.quantity * l.unitCostCents);
    if (l.taxable) taxable += p;
  }
  const taxCents = Math.round((taxable * taxBps) / 10_000);
  return { subtotalCents: sub, taxCents, totalCents: sub + taxCents, costCents: cost, profitCents: sub - cost };
}

export interface ChangeOrder {
  id: string; number: string; title: string; description: string | null; status: CoStatus;
  job: { id: string; number: string; name: string };
  taxBps: number; lines: CoLine[]; totals: CoTotals;
  sentAt: string | null; approvedAt: string | null; approvedNote: string | null; declinedAt: string | null; declineNote: string | null;
  signature: { signerName: string; signerEmail: string | null; signerTitle: string | null; signedAt: string; totalCents: number; image: string | null } | null;
  clientUrl: string | null;
  createdBy: string | null; createdAt: string;
}
export interface CoRow { id: string; number: string; title: string; status: CoStatus; totalCents: number; createdAt: string; approvedAt: string | null }

/** What the client sees from the change order link: no costs. */
export interface ClientChangeOrderPage {
  co: { number: string; title: string; description: string | null; status: CoStatus; sentAt: string | null; lines: Pick<CoLine, "groupName" | "name" | "description" | "quantity" | "unit" | "unitPriceCents">[]; totals: Pick<CoTotals, "subtotalCents" | "taxCents" | "totalCents">; taxBps: number };
  job: { number: string; name: string; contractCents: number; approvedChangesCents: number };
  customer: { name: string; contactName: string | null; email: string | null } | null;
  business: { name: string; address: string | null; phone: string | null; email: string | null };
  logo: string | null;
  canAnswer: boolean;
  signature: { signerName: string; signerTitle: string | null; signedAt: string; totalCents: number } | null;
  declined: { at: string; note: string | null } | null;
}

/* ───────────── Job costing ───────────── */

export type CostLinkKind = "PROPOSAL" | "CHANGE_ORDER" | "PO" | "WORK_ORDER" | "BILL";
export interface CostLink { kind: CostLinkKind; id: string; label: string }

/** Per budget item, from the server: committed and actual cost and the documents behind them. */
export interface ItemCosts { committedCents: number; actualCents: number; links: CostLink[] }

export interface CostingRow {
  id: string; parentId: string | null; kind: "GROUP" | "ITEM"; name: string; costType: BudgetItem["costType"]; depth: number;
  final: boolean;
  budgetCents: number; committedCents: number; actualCents: number; projectedCents: number; remainingCents: number;
  /** Logged time counted in actual (labor items only). */
  timeCents: number;
  links: CostLink[];
}
export interface JobCosting {
  rows: CostingRow[];
  /** Costs on the job that aren't on a budget line: PO shipping and tax, bill extras, lines with no budget item. */
  unassigned: { committedCents: number; actualCents: number; links: CostLink[] };
  /** Logged time with no labor item to put it on. */
  unplacedTimeCents: number;
  timeCents: number;
  totals: { budgetCents: number; committedCents: number; actualCents: number; projectedCents: number; remainingCents: number; priceCents: number; projectedProfitCents: number; projectedMarginBps: number };
  openBillsCents: number;
  waitingApproval: number;
}

export const projected = (budget: number, committed: number, actual: number, final: boolean) => (final ? actual : Math.max(budget, committed, actual));

/**
 * The costing grid: every budget row with its figures. Logged time is spread over the labor items in
 * proportion to their budgeted cost (or reported as unplaced when there are none).
 */
export function jobCosting(items: (BudgetItem & { final?: boolean })[], per: Map<string, ItemCosts>, timeCents: number, unassigned: JobCosting["unassigned"], extra: { openBillsCents: number; waitingApproval: number }): JobCosting {
  const kids = new Map<string | null, typeof items>();
  for (const i of items) kids.set(i.parentId, [...(kids.get(i.parentId) ?? []), i]);
  for (const l of kids.values()) l.sort((a, b) => a.sortOrder - b.sortOrder);
  const cost = (i: BudgetItem) => Math.round(i.quantity * i.unitCostCents);
  const price = (i: BudgetItem) => Math.round(i.quantity * i.unitPriceCents);
  const labor = items.filter((i) => i.kind === "ITEM" && i.costType === "LABOR");
  const laborBudget = labor.reduce((s, i) => s + Math.max(0, cost(i)), 0);
  const timeOf = new Map<string, number>();
  let placed = 0;
  if (timeCents > 0 && labor.length) {
    labor.forEach((i, n) => {
      const share = n === labor.length - 1 ? timeCents - placed : Math.round(laborBudget > 0 ? (timeCents * Math.max(0, cost(i))) / laborBudget : timeCents / labor.length);
      timeOf.set(i.id, share); placed += share;
    });
  }
  const rows: CostingRow[] = [];
  let priceTotal = 0;
  const walk = (parent: string | null, depth: number, seen: Set<string>): Omit<CostingRow, "id" | "parentId" | "kind" | "name" | "costType" | "depth" | "final" | "links"> => {
    const sum = { budgetCents: 0, committedCents: 0, actualCents: 0, projectedCents: 0, remainingCents: 0, timeCents: 0 };
    for (const i of kids.get(parent) ?? []) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      const at = rows.length;
      let r: typeof sum;
      if (i.kind === "GROUP") {
        rows.push(null as unknown as CostingRow);
        r = depth < 6 ? walk(i.id, depth + 1, seen) : { ...sum };
        rows[at] = { id: i.id, parentId: i.parentId, kind: "GROUP", name: i.name, costType: i.costType, depth, final: false, links: [], ...r };
      } else {
        const c = per.get(i.id) ?? { committedCents: 0, actualCents: 0, links: [] };
        const t = timeOf.get(i.id) ?? 0;
        const b = cost(i), act = c.actualCents + t;
        const p = projected(b, c.committedCents, act, !!i.final);
        r = { budgetCents: b, committedCents: c.committedCents, actualCents: act, projectedCents: p, remainingCents: b - p, timeCents: t };
        priceTotal += price(i);
        rows.push({ id: i.id, parentId: i.parentId, kind: "ITEM", name: i.name, costType: i.costType, depth, final: !!i.final, links: c.links, ...r });
      }
      for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += r[k];
    }
    return sum;
  };
  const t = walk(null, 0, new Set());
  const unplacedTimeCents = timeCents - placed;
  const committedCents = t.committedCents + unassigned.committedCents;
  const actualCents = t.actualCents + unassigned.actualCents + unplacedTimeCents;
  const extraProjected = Math.max(unassigned.committedCents, unassigned.actualCents) + unplacedTimeCents;
  const projectedCents = t.projectedCents + extraProjected;
  const profit = priceTotal - projectedCents;
  return {
    rows, unassigned, unplacedTimeCents, timeCents,
    totals: { budgetCents: t.budgetCents, committedCents, actualCents, projectedCents, remainingCents: t.budgetCents - projectedCents, priceCents: priceTotal, projectedProfitCents: profit, projectedMarginBps: priceTotal > 0 ? Math.round((profit / priceTotal) * 10_000) : 0 },
    ...extra,
  };
}

/** A budget item's place in its tree, for pickers: "Audio › Wireless › ULXD4". */
export function budgetItemLabel(items: Pick<BudgetItem, "id" | "parentId" | "name">[], id: string | null): string {
  if (!id) return "";
  const by = new Map(items.map((i) => [i.id, i]));
  const parts: string[] = [];
  for (let x = by.get(id), n = 0; x && n < 8; x = x.parentId ? by.get(x.parentId) : undefined, n++) parts.unshift(x.name);
  return parts.join(" › ");
}

/** The job's material lines that still need ordering (budget quantity not yet on a PO). */
export interface OrderableLine {
  budgetItemId: string; name: string; group: string | null; sku: string | null; productId: string | null;
  vendorId: string | null; vendorName: string | null;
  budgetQty: number; orderedQty: number; remainingQty: number; unit: string | null; unitCostCents: number;
}

/** Purchasing page and the job's purchasing tab. */
export interface PurchasingPage {
  pos: PoRow[];
  bills: BillRow[];
  workOrders: WoRow[];
  counts: { waitingApproval: number; toReceive: number; openBills: number; openBillsCents: number; overdueBills: number };
  vendors: { id: string; name: string; repEmail: string | null }[];
  jobs: { id: string; number: string; name: string }[];
  canApprove: boolean;
}
export interface JobPurchasing extends PurchasingPage {
  orderable: OrderableLine[];
  changeOrders: CoRow[];
}
