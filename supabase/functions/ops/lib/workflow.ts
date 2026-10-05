// Generated from shared/ops/workflow.ts by supabase/build-ops.mjs — edit that file instead.
/**
 * Request hub state machine (pure — shared by API, UI and tests).
 *
 *  APPROVAL     (Technology):  PENDING_APPROVAL → APPROVED → [ORDERED] → COMPLETED
 *  FULFILLMENT  (Supplies):    NEW → IN_PROGRESS → COMPLETED
 *                              (PENDING_APPROVAL first when estimate > category threshold)
 *  WORK_ORDER   (Maintenance): NEW → ASSIGNED → IN_PROGRESS ⇄ ON_HOLD → COMPLETED
 *
 *  Any workflow: DENIED from PENDING_APPROVAL; CANCELLED before work starts.
 */
export const REQUEST_STATUSES = [
  "NEW",
  "PENDING_APPROVAL",
  "APPROVED",
  "DENIED",
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "ORDERED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export type RequestWorkflow = "APPROVAL" | "FULFILLMENT" | "WORK_ORDER";
export type RequestKind = "TECHNOLOGY" | "SUPPLY" | "MAINTENANCE" | "OTHER";

export type RequestAction = "APPROVE" | "DENY" | "ASSIGN" | "START" | "HOLD" | "ORDER" | "COMPLETE" | "CANCEL" | "REOPEN";

/** Who may perform an action. `handler` = member of the routed team (or admin). */
export type RequestRole = "approver" | "handler" | "requester";

interface ActionDef {
  from: readonly RequestStatus[];
  /** null = status unchanged (e.g. reassigning an in-progress job) */
  to: (current: RequestStatus) => RequestStatus | null;
  roles: readonly RequestRole[];
  workflows?: readonly RequestWorkflow[];
  noteRequired?: boolean;
  label: string;
}

const ACTIVE: RequestStatus[] = ["NEW", "APPROVED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "ORDERED"];

export const REQUEST_ACTIONS: Record<RequestAction, ActionDef> = {
  APPROVE: { from: ["PENDING_APPROVAL"], to: () => "APPROVED", roles: ["approver"], label: "Approve" },
  DENY: { from: ["PENDING_APPROVAL"], to: () => "DENIED", roles: ["approver"], noteRequired: true, label: "Deny" },
  ASSIGN: {
    from: ACTIVE,
    to: (s) => (s === "NEW" || s === "APPROVED" ? "ASSIGNED" : null),
    roles: ["handler"],
    label: "Assign",
  },
  START: { from: ["NEW", "APPROVED", "ASSIGNED", "ON_HOLD"], to: () => "IN_PROGRESS", roles: ["handler"], label: "Start" },
  HOLD: { from: ["ASSIGNED", "IN_PROGRESS"], to: () => "ON_HOLD", roles: ["handler"], noteRequired: true, label: "Put on hold" },
  ORDER: {
    from: ["APPROVED", "ASSIGNED", "IN_PROGRESS"],
    to: () => "ORDERED",
    roles: ["handler"],
    workflows: ["APPROVAL", "FULFILLMENT"],
    label: "Mark ordered",
  },
  COMPLETE: { from: ACTIVE, to: () => "COMPLETED", roles: ["handler"], label: "Complete" },
  CANCEL: {
    from: ["NEW", "PENDING_APPROVAL", "APPROVED", "ASSIGNED"],
    to: () => "CANCELLED",
    roles: ["requester", "handler"],
    label: "Cancel",
  },
  REOPEN: { from: ["COMPLETED"], to: () => "IN_PROGRESS", roles: ["handler", "requester"], noteRequired: true, label: "Reopen" },
};

export type ActionResult = { ok: true; to: RequestStatus | null } | { ok: false; error: string };

export function applyRequestAction(opts: {
  status: RequestStatus;
  workflow: RequestWorkflow;
  action: RequestAction;
  roles: RequestRole[];
  note?: string | null;
  assigneeId?: string | null;
}): ActionResult {
  const def = REQUEST_ACTIONS[opts.action];
  if (!def) return { ok: false, error: "Unknown action" };
  if (!def.roles.some((r) => opts.roles.includes(r))) return { ok: false, error: "You don't have permission to do that." };
  if (def.workflows && !def.workflows.includes(opts.workflow))
    return { ok: false, error: `${def.label} isn't used for this kind of request.` };
  if (!def.from.includes(opts.status))
    return { ok: false, error: `Can't ${def.label.toLowerCase()} a request that is ${labelStatus(opts.status)}.` };
  if (def.noteRequired && !opts.note?.trim()) return { ok: false, error: "Please add a note." };
  if (opts.action === "ASSIGN" && !opts.assigneeId) return { ok: false, error: "Choose someone to assign." };
  return { ok: true, to: def.to(opts.status) };
}

export function availableActions(status: RequestStatus, workflow: RequestWorkflow, roles: RequestRole[]): RequestAction[] {
  return (Object.keys(REQUEST_ACTIONS) as RequestAction[]).filter((a) => {
    const d = REQUEST_ACTIONS[a];
    return d.from.includes(status) && d.roles.some((r) => roles.includes(r)) && (!d.workflows || d.workflows.includes(workflow));
  });
}

/** Initial status on submit. */
export function initialStatus(
  workflow: RequestWorkflow,
  estimatedCents: number | null | undefined,
  approvalThresholdCents: number | null | undefined,
): RequestStatus {
  if (workflow === "APPROVAL") return "PENDING_APPROVAL";
  if (workflow === "FULFILLMENT" && approvalThresholdCents != null && (estimatedCents ?? 0) > approvalThresholdCents)
    return "PENDING_APPROVAL";
  return "NEW";
}

/** Route resolution: campus-specific route wins over the fallback (campusId = null). */
export function resolveRoute<T extends { categoryId: string; campusId: string | null }>(
  routes: T[],
  categoryId: string,
  campusId: string,
): T | null {
  return (
    routes.find((r) => r.categoryId === categoryId && r.campusId === campusId) ??
    routes.find((r) => r.categoryId === categoryId && r.campusId === null) ??
    null
  );
}

export const OPEN_STATUSES: RequestStatus[] = ["NEW", "PENDING_APPROVAL", "APPROVED", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "ORDERED"];

export const labelStatus = (s: RequestStatus) =>
  ({
    NEW: "new",
    PENDING_APPROVAL: "pending approval",
    APPROVED: "approved",
    DENIED: "denied",
    ASSIGNED: "assigned",
    IN_PROGRESS: "in progress",
    ON_HOLD: "on hold",
    ORDERED: "ordered",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
  })[s];


export const KIND_LABEL: Record<RequestKind, string> = {
  TECHNOLOGY: "Technology",
  SUPPLY: "Supplies",
  MAINTENANCE: "Facilities & Maintenance",
  OTHER: "Other",
};
