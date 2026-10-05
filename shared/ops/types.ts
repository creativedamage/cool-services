/** What the ops Edge Function sends Sundays (Sundays | Operations screens). Plain data, ISO dates. */
import type { AvlLevel, Permission, Role } from "./rbac";
import type { RequestAction, RequestKind, RequestRole, RequestStatus, RequestWorkflow } from "./workflow";
import type { QuoteStatus } from "./state-machine";

export type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export interface Ref { id: string; name: string }

export interface OpsSessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  avlLevel: AvlLevel;
  permissions: Permission[];
  opsAccess: boolean;
  campusId: string | null;
  allCampuses: boolean;
  teamIds: string[];
}

export type OpsMe =
  | { status: "ok"; user: OpsSessionUser; org: OrgBrand; nav: OpsNav }
  | { status: "pending" | "inactive"; name: string; email: string; org: OrgBrand };

export interface OrgBrand { name: string | null; logo: string | null; logoDark: string | null }
export interface OpsNav {
  handlesRequests: boolean; queueCount: number; pendingUsers: number; manager: boolean; admin: boolean; campusName: string | null;
  /** Which apps this person can open. */
  ops: boolean; avl: boolean; avlManager: boolean; avlPending: number; avlName: string | null;
}

export interface RequestRow {
  id: string; number: string; title: string; details: string; location: string | null;
  priority: Priority; status: RequestStatus; quantity: number; estimatedCents: number | null;
  neededBy: string | null; createdAt: string; updatedAt: string; completedAt: string | null;
  requesterId: string; campusId: string; assignedTeamId: string | null; assigneeId: string | null; approverTeamId: string | null;
  category: { id: string; name: string; icon: string | null; kind: RequestKind; workflow: RequestWorkflow };
  campus: { id: string; name: string; code: string };
  requester: { id: string; name: string; email: string };
  assignee: { id: string; name: string; email: string } | null;
  assignedTeam: Ref | null;
  approver: Ref | null;
  lines: { id: string; description: string; quantity: number; unit: string | null }[];
}

export interface CategoryOption {
  id: string; name: string; kind: RequestKind; workflow: RequestWorkflow; description: string | null; icon: string | null;
  requiresLocation: boolean; allowLineItems: boolean; approvalThresholdCents: number | null;
  supplyItems: { id: string; name: string; unit: string; unitCostCents: number | null }[];
}

export interface TimelineEntry { at: string; who: string; kind: "event" | "comment"; action: string; toStatus: string | null; note: string | null; internal: boolean }
export interface RequestDetail { request: RequestRow; roles: RequestRole[]; actions: RequestAction[]; staffSide: boolean; timeline: TimelineEntry[]; teamMembers: Ref[] }

export interface ActivityRow { id: string; actorName: string | null; actorLabel: string | null; action: string; detail: string | null; area: string; href: string | null; createdAt: string }

export interface OverviewData {
  queue: { approval: number; open: number; urgent: number; doneWeek: number } | null;
  mine: { open: RequestRow[]; awaiting: number; completed30: number };
  activity: ActivityRow[];
  canViewActivity: boolean;
}

export interface QuoteRow {
  id: string; number: string; title: string; status: QuoteStatus; createdAt: string; updatedAt: string; sentAt: string | null; validUntil: string | null;
  customer: { name: string; contactName: string | null }; campus: { name: string } | null; totalCents: number; marginBps: number;
}

export interface LineItemDraft {
  key: string; productId: string | null; isCustom: boolean; section: string | null; sku: string | null; name: string; description: string | null;
  quantity: number; unitCostCents: number; unitPriceCents: number; taxable: boolean;
}
export interface QuoteDTO {
  id: string; number: string; title: string; status: QuoteStatus; customerId: string; campusId: string | null;
  introNotes: string | null; internalNotes: string | null; terms: string | null;
  taxBps: number; discountCents: number; depositBps: number; validUntil: string | null; sentTotalCents: number | null;
  items: LineItemDraft[];
  events: { id: string; type: string; fromStatus: QuoteStatus | null; toStatus: QuoteStatus | null; actorLabel: string | null; note: string | null; createdAt: string }[];
  signature: { signerName: string; signerEmail: string; signedAt: string } | null;
  paidCents: number;
}
export interface CustomerOption { id: string; name: string; email: string | null; taxExempt: boolean }
export interface QuotePage { quote: QuoteDTO; customers: CustomerOption[]; vendors: Ref[]; campuses: Ref[]; defaultMarginBps: number; laborRateCents: number; canApprove: boolean }

export interface PublicQuote {
  number: string; title: string; status: QuoteStatus; introNotes: string | null; terms: string | null; validUntil: string | null; sentAt: string | null; createdAt: string;
  customer: { name: string; contactName: string | null; email: string | null };
  items: { id: string; section: string | null; sku: string | null; name: string; description: string | null; quantity: number; unitPriceCents: number; taxable: boolean }[];
  totals: { subtotalCents: number; discountCents: number; taxCents: number; totalCents: number; depositCents: number };
}
export interface OrgSettings {
  name: string | null; legalName: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null;
  postalCode: string | null; phone: string | null; email: string | null; website: string | null; ein: string | null; salesTaxId: string | null;
  quotePrefix: string; taxExempt: boolean; defaultTaxBps: number; defaultDepositBps: number; defaultMarginBps: number; laborRateCents: number;
  quoteValidDays: number; quoteTerms: string | null;
}
export interface PrintData { quote: PublicQuote; org: AvlBusiness; logo: string | null }

export interface CatalogProduct {
  id: string; sku: string; model: string | null; name: string; manufacturer: string | null; category: string | null; description: string | null;
  costCents: number; msrpCents: number | null; mapCents: number | null; updatedAt: string; vendor: Ref;
}
export interface VendorRow {
  id: string; name: string; accountNo: string | null; repName: string | null; repEmail: string | null; repPhone: string | null;
  website: string | null; terms: string | null; notes: string | null; active: boolean; productCount: number;
}
export interface ImportBatchRow { id: string; fileName: string; status: string; created: number; updated: number; skipped: number; createdAt: string; uploadedBy: string }

export interface UserRow {
  id: string; email: string; name: string; title: string | null; department: string | null; phone: string | null;
  active: boolean; pending: boolean; registered: boolean; campusId: string | null; campusName: string | null; allCampuses: boolean;
  role: Role; avlLevel: AvlLevel; opsAccess: boolean; effectiveRole: Role; effectiveAvl: AvlLevel; global: boolean; source: string;
  teams: { id: string; name: string; synced: boolean }[]; lastLoginAt: string | null; createdAt: string; editable: boolean;
}
export interface CampusRow {
  id: string; name: string; code: string; addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null;
  phone: string | null; sortOrder: number; active: boolean; users: number; teams: number; requests: number;
}
export interface TeamRow { id: string; name: string; description: string | null; campusId: string | null; campusName: string | null; email: string | null; active: boolean; members: number; handles: number; approves: number; manageable: boolean }
export interface CategoryRow {
  id: string; name: string; kind: RequestKind; workflow: RequestWorkflow; description: string | null; icon: string | null;
  approvalThresholdCents: number | null; requiresLocation: boolean; allowLineItems: boolean; active: boolean; sortOrder: number;
  supplyItemCount: number; requestCount: number; routing: { campusId: string | null; handlerTeam: string; approverTeam: string | null }[];
}

/* ── AVL ── */
export interface AvlOverview {
  pipelineCents: number; acceptedCents: number; profitCents: number; openPurchasingCents: number;
  clients: number; recent: QuoteRow[]; activity: ActivityRow[];
}
export interface ClientRow {
  id: string; name: string; contactName: string | null; email: string | null; phone: string | null; city: string | null; state: string | null;
  active: boolean; taxExempt: boolean; quotes: number; openCents: number; wonCents: number; lastQuoteAt: string | null;
}
export interface ClientContact { id: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean }
export interface ClientDetail {
  id: string; name: string; contactName: string | null; email: string | null; phone: string | null; website: string | null;
  addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; postalCode: string | null;
  taxExempt: boolean; notes: string | null; active: boolean; createdAt: string;
}
export interface ClientPage { client: ClientDetail; contacts: ClientContact[]; quotes: QuoteRow[]; totals: { openCents: number; wonCents: number } }
export interface AvlPerson { id: string; name: string; email: string; avlLevel: AvlLevel; opsAccess: boolean; role: Role; pending: boolean; active: boolean; lastLoginAt: string | null }
export interface AvlBusiness {
  name: string | null; legalName: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null;
  postalCode: string | null; phone: string | null; email: string | null; website: string | null; ein: string | null; salesTaxId: string | null;
  quotePrefix: string; defaultTaxBps: number; defaultDepositBps: number; defaultMarginBps: number; laborRateCents: number;
  quoteValidDays: number; quoteTerms: string | null;
}
