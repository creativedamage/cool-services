/**
 * Sundays AVL CRM: leads on a board, and activity (notes, calls, follow-ups) on leads, clients and jobs.
 */

export type LeadStage = "NEW" | "CONTACTED" | "SITE_VISIT" | "PROPOSAL" | "WON" | "LOST";
export const LEAD_STAGES: { id: LeadStage; label: string; open: boolean }[] = [
  { id: "NEW", label: "New", open: true },
  { id: "CONTACTED", label: "Contacted", open: true },
  { id: "SITE_VISIT", label: "Site visit", open: true },
  { id: "PROPOSAL", label: "Proposal sent", open: true },
  { id: "WON", label: "Won", open: false },
  { id: "LOST", label: "Lost", open: false },
];
export const OPEN_STAGES = LEAD_STAGES.filter((s) => s.open).map((s) => s.id);
export const stageLabel = (s: LeadStage) => LEAD_STAGES.find((x) => x.id === s)?.label ?? s;
export const stageIndex = (s: LeadStage) => LEAD_STAGES.findIndex((x) => x.id === s);

/** Offered when adding a lead; anything typed is kept too. */
export const DEFAULT_SOURCES = ["Referral", "Repeat client", "Website", "Phone call", "Trade show", "Social media", "Denomination / network"];

export type ActivityKind = "NOTE" | "CALL" | "EMAIL" | "MEETING" | "SITE_VISIT" | "TASK" | "STAGE";
export const ACTIVITY_KINDS: { id: Exclude<ActivityKind, "STAGE">; label: string; verb: string }[] = [
  { id: "NOTE", label: "Note", verb: "Note" },
  { id: "CALL", label: "Call", verb: "Called" },
  { id: "EMAIL", label: "Email", verb: "Emailed" },
  { id: "MEETING", label: "Meeting", verb: "Met" },
  { id: "SITE_VISIT", label: "Site visit", verb: "Site visit" },
  { id: "TASK", label: "Follow-up", verb: "Follow-up" },
];
export const activityLabel = (k: ActivityKind) => (k === "STAGE" ? "Stage" : ACTIVITY_KINDS.find((x) => x.id === k)?.label ?? k);

export interface Ref { id: string; name: string }

export interface LeadRow {
  id: string; title: string; stage: LeadStage;
  /** The client, or the prospect's name until it becomes one. */
  customer: Ref | null; orgName: string | null;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null; city: string | null; state: string | null;
  valueCents: number; source: string | null; owner: Ref | null; expectedClose: string | null;
  quote: { id: string; number: string; status: string } | null;
  job: { id: string; number: string } | null;
  lostReason: string | null; position: number;
  /** The soonest open follow-up. */
  nextFollowUp: { id: string; body: string; dueAt: string } | null;
  wonAt: string | null; lostAt: string | null; createdAt: string; updatedAt: string;
}
export const leadName = (l: Pick<LeadRow, "customer" | "orgName">) => l.customer?.name ?? l.orgName ?? "No church yet";

export interface LeadDetail extends LeadRow { notes: string | null; customerId: string | null; ownerId: string | null; createdBy: string | null; createdById: string | null }

export interface Activity {
  id: string; kind: ActivityKind; body: string;
  lead: { id: string; title: string } | null; customer: Ref | null; job: { id: string; number: string; name: string } | null;
  dueAt: string | null; doneAt: string | null;
  assignedTo: Ref | null; createdBy: Ref | null;
  createdAt: string;
}
export const isFollowUp = (a: Pick<Activity, "dueAt">) => !!a.dueAt;

export interface LeadsBoard {
  leads: LeadRow[];
  /** Won and lost leads closed more than this many days ago are left off the board. */
  closedDays: number;
  people: Ref[];
  customers: Ref[];
  sources: string[];
}
export interface LeadPage { lead: LeadDetail; activities: Activity[]; people: Ref[]; customers: Ref[]; sources: string[] }

export interface SourceRow { source: string; leads: number; open: number; won: number; lost: number; wonCents: number; winRateBps: number }
export interface LeadReport { since: string; sources: SourceRow[]; total: SourceRow }

/** Open follow-ups for the AVL home: overdue first. */
export interface FollowUps { overdue: Activity[]; today: Activity[]; upcoming: Activity[] }
