/**
 * Request hub: submit, route, act, comment. Every status change goes through
 * performRequestAction (row-locked, audited). Ported from coolchurch-ops lib/server/requests.ts.
 * (Email notifications aren't sent yet; the work queue and badges in Sundays show what's waiting.)
 */
import { applyRequestAction, availableActions, initialStatus, OPEN_STATUSES, resolveRoute, type RequestAction, type RequestRole } from "./lib/workflow.ts";
import { atLeast, canAccessCampus, isAdmin, seesAllCampuses } from "./lib/rbac.ts";
import type { OpsSessionUser, RequestDetail, RequestRow, TimelineEntry } from "./lib/types.ts";
import { getOrg, HttpError, logActivity, nextNumber, sql, type Tx } from "./db.ts";

type U = OpsSessionUser;

/** Requests with everything a list or the detail page shows. `where` is a SQL fragment on r. */
export async function requestRows(where: ReturnType<typeof sql>, order: ReturnType<typeof sql> = sql`r.created_at desc`, limit = 300): Promise<RequestRow[]> {
  return (await sql`
    select r.id, r.number, r.title, r.details, r.location, r.priority, r.status, r.quantity, r.estimated_cents, r.needed_by,
      r.created_at, r.updated_at, r.completed_at, r.requester_id, r.campus_id, r.assigned_team_id, r.assignee_id, r.approver_team_id,
      json_build_object('id', c.id, 'name', c.name, 'icon', c.icon, 'kind', c.kind, 'workflow', c.workflow) as category,
      json_build_object('id', ca.id, 'name', ca.name, 'code', ca.code) as campus,
      json_build_object('id', rq.id, 'name', rq.name, 'email', rq.email) as requester,
      case when asg.id is null then null else json_build_object('id', asg.id, 'name', asg.name, 'email', asg.email) end as assignee,
      case when t.id is null then null else json_build_object('id', t.id, 'name', t.name) end as assigned_team,
      case when ap.id is null then null else json_build_object('id', ap.id, 'name', ap.name) end as approver,
      coalesce((select json_agg(json_build_object('id', l.id, 'description', l.description, 'quantity', l.quantity, 'unit', l.unit) order by l.id)
        from ops.request_lines l where l.request_id = r.id), '[]') as lines
    from ops.requests r
      join ops.request_categories c on c.id = r.category_id
      join ops.campuses ca on ca.id = r.campus_id
      join ops.users rq on rq.id = r.requester_id
      left join ops.users asg on asg.id = r.assignee_id
      left join ops.teams t on t.id = r.assigned_team_id
      left join ops.users ap on ap.id = r.approver_id
    where ${where}
    order by ${order}
    limit ${limit}`) as unknown as RequestRow[];
}

/** Managers+ always work requests; others only if one of their teams is routed. */
export async function handlesRequests(u: U) {
  if (atLeast(u, "MANAGER")) return true;
  if (!u.teamIds.length) return false;
  const [{ n }] = await sql`select count(*)::int as n from ops.category_routings where handler_team_id = any(${u.teamIds}) or approver_team_id = any(${u.teamIds})`;
  return n > 0;
}

/**
 * The requests someone works on (a SQL fragment on r):
 *  executives / admins / global managers → everything · campus managers → their campus
 *  team members → their teams' queues + approvals routed to their team
 */
export function workQueueWhere(u: U, opts: { openOnly?: boolean } = {}) {
  const open = opts.openOnly ? sql`r.status = any(${OPEN_STATUSES})` : sql`true`;
  if (atLeast(u, "MANAGER") && seesAllCampuses(u)) return open;
  const or = [];
  if (atLeast(u, "MANAGER") && u.campusId) or.push(sql`r.campus_id = ${u.campusId}`);
  if (u.teamIds.length) {
    or.push(sql`r.assigned_team_id = any(${u.teamIds})`);
    or.push(sql`(r.status = 'PENDING_APPROVAL' and r.approver_team_id = any(${u.teamIds}))`);
  }
  if (!or.length) return sql`false`;
  const any = or.reduce((a, b) => sql`${a} or ${b}`);
  return sql`(${open}) and (${any})`;
}

export function rolesFor(u: U, r: { requesterId: string; assignedTeamId: string | null; approverTeamId: string | null; campusId: string }): RequestRole[] {
  const roles: RequestRole[] = [];
  const managerHere = atLeast(u, "MANAGER") && canAccessCampus(u, r.campusId);
  if (r.requesterId === u.id) roles.push("requester");
  // Handlers: the routed team, managers of that campus, and system admins.
  if (isAdmin(u) || managerHere || (r.assignedTeamId && u.teamIds.includes(r.assignedTeamId))) roles.push("handler");
  // Approvers: executives, managers of that campus, and the routed approving team.
  if (atLeast(u, "EXECUTIVE") || managerHere || (r.approverTeamId && u.teamIds.includes(r.approverTeamId))) roles.push("approver");
  return roles;
}

export async function loadRequestFor(u: U, id: string) {
  const [r] = await requestRows(sql`r.id = ${id}`);
  if (!r) throw new HttpError(404, "Request not found");
  const roles = rolesFor(u, r);
  if (!roles.length) throw new HttpError(404, "Request not found");
  return { request: r, roles };
}

export async function requestDetail(u: U, id: string): Promise<RequestDetail> {
  const { request: r, roles } = await loadRequestFor(u, id);
  const staffSide = roles.includes("handler") || roles.includes("approver");
  const [events, comments, members] = await Promise.all([
    sql`select e.created_at, e.action, e.to_status, e.note, coalesce(a.name, 'System') as who
        from ops.request_events e left join ops.users a on a.id = e.actor_id where e.request_id = ${id} order by e.created_at`,
    sql`select c.created_at, c.body, c.internal, a.name as who from ops.request_comments c join ops.users a on a.id = c.author_id
        where c.request_id = ${id} ${staffSide ? sql`` : sql`and not c.internal`} order by c.created_at`,
    r.assignedTeamId
      ? sql`select u.id, u.name from ops.team_members m join ops.users u on u.id = m.user_id where m.team_id = ${r.assignedTeamId} and u.active order by u.name`
      : Promise.resolve([]),
  ]);
  const timeline: TimelineEntry[] = [
    ...events.map((e) => ({ at: e.createdAt, who: e.who, kind: "event" as const, action: e.action, toStatus: e.toStatus, note: e.note, internal: false })),
    ...comments.map((c) => ({ at: c.createdAt, who: c.who, kind: "comment" as const, action: "COMMENT", toStatus: null, note: c.body, internal: c.internal })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return {
    request: r, roles, staffSide, timeline,
    actions: availableActions(r.status, r.category.workflow, roles),
    teamMembers: members.map((m) => ({ id: m.id, name: m.name })),
  };
}

export interface SubmitInput {
  categoryId: string; campusId: string; title: string; details: string; location?: string | null; quantity: number;
  unitEstimateCents?: number | null; neededBy?: string | null; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  lines?: { supplyItemId?: string | null; description?: string | null; quantity: number }[];
}

export async function submitRequest(u: U, input: SubmitInput) {
  const [[category], [campus], routes, items, org] = await Promise.all([
    sql`select * from ops.request_categories where id = ${input.categoryId}`,
    sql`select * from ops.campuses where id = ${input.campusId}`,
    sql`select * from ops.category_routings where category_id = ${input.categoryId}`,
    sql`select * from ops.supply_items where category_id = ${input.categoryId}`,
    getOrg(),
  ]);
  if (!category?.active) throw new HttpError(422, "Choose a request type.");
  if (!campus?.active) throw new HttpError(422, "Choose a campus.");
  if (category.requiresLocation && !input.location?.trim()) throw new HttpError(422, "Please tell us where (building / room).");

  const lines = (category.allowLineItems ? input.lines ?? [] : [])
    .filter((l) => l.quantity > 0)
    .map((l) => {
      const item = l.supplyItemId ? items.find((s) => s.id === l.supplyItemId && s.active) : null;
      if (l.supplyItemId && !item) throw new HttpError(422, "One of the selected items is no longer available.");
      const description = item?.name ?? l.description?.trim();
      if (!description) throw new HttpError(422, "Describe each item.");
      return { supplyItemId: item?.id ?? null, description, quantity: l.quantity, unit: item?.unit ?? null, unitCost: (item?.unitCostCents as number | null) ?? null };
    });
  if (category.allowLineItems && !lines.length && !input.details.trim()) throw new HttpError(422, "Add at least one item.");

  const estimatedCents = lines.length
    ? lines.reduce((s, l) => s + (l.unitCost ?? 0) * l.quantity, 0) || null
    : input.unitEstimateCents != null ? input.unitEstimateCents * input.quantity : null;

  const route = resolveRoute(routes as unknown as { categoryId: string; campusId: string | null; handlerTeamId: string; approverTeamId: string | null }[], category.id, campus.id);
  const status = initialStatus(category.workflow, estimatedCents, category.approvalThresholdCents);

  const r = await sql.begin(async (tx) => {
    const [row] = await tx`insert into ops.requests ${tx({
      number: await nextNumber(tx, "R", org.quotePrefix), requesterId: u.id, categoryId: category.id, campusId: campus.id,
      title: input.title.trim(), details: input.details.trim(), location: input.location?.trim() || null,
      quantity: lines.length ? 1 : input.quantity, estimatedCents, neededBy: input.neededBy ? new Date(input.neededBy) : null,
      priority: input.priority, status, assignedTeamId: route?.handlerTeamId ?? null,
      approverTeamId: status === "PENDING_APPROVAL" ? route?.approverTeamId ?? null : null,
    })} returning *`;
    for (const { unitCost: _u, ...l } of lines) await tx`insert into ops.request_lines ${tx({ ...l, requestId: row.id })}`;
    await tx`insert into ops.request_events ${tx({ requestId: row.id, action: "SUBMIT", toStatus: status, actorId: u.id })}`;
    return row;
  });
  await logActivity({ actorId: u.id, action: "Submitted request", detail: `${r.number} · ${category.name} · ${campus.name}`, area: "REQUESTS", entityType: "InternalRequest", entityId: r.id, href: `/ops/requests/view?id=${r.id}`, campusId: campus.id });
  return r;
}

const actionVerb = (a: RequestAction) =>
  ({ APPROVE: "Approved", DENY: "Denied", ASSIGN: "Assigned", START: "Started", HOLD: "Put on hold", ORDER: "Ordered for", COMPLETE: "Completed", CANCEL: "Cancelled", REOPEN: "Reopened" })[a];

export async function performRequestAction(u: U, id: string, input: { action: RequestAction; note?: string | null; assigneeId?: string | null }) {
  const updated = await sql.begin(async (tx: Tx) => {
    const [r] = await tx`select r.*, c.workflow from ops.requests r join ops.request_categories c on c.id = r.category_id where r.id = ${id} for update of r`;
    if (!r) throw new HttpError(404, "Request not found");
    const roles = rolesFor(u, r as never);
    if (!roles.length) throw new HttpError(404, "Request not found");
    const res = applyRequestAction({ status: r.status, workflow: r.workflow, action: input.action, roles, note: input.note, assigneeId: input.assigneeId });
    if (!res.ok) throw new HttpError(409, res.error);

    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (res.to) data.status = res.to;
    if (input.action === "ASSIGN") {
      const [member] = r.assignedTeamId ? await tx`select 1 from ops.team_members where team_id = ${r.assignedTeamId} and user_id = ${input.assigneeId!}` : [];
      const managerHere = atLeast(u, "MANAGER") && canAccessCampus(u, r.campusId);
      if (!member && !isAdmin(u) && !managerHere) throw new HttpError(422, "Assignee must be on the handling team.");
      const [exists] = await tx`select 1 from ops.users where id = ${input.assigneeId!} and active`;
      if (!exists) throw new HttpError(422, "Choose someone to assign.");
      data.assigneeId = input.assigneeId;
    }
    if (input.action === "START" && !r.assigneeId) data.assigneeId = u.id;
    if (input.action === "APPROVE" || input.action === "DENY") {
      data.approverId = u.id;
      data.decidedAt = new Date();
      data.decisionNote = input.note?.trim() || null;
    }
    if (input.action === "COMPLETE") data.completedAt = new Date();
    if (input.action === "REOPEN") data.completedAt = null;
    const [row] = await tx`update ops.requests set ${tx(data)} where id = ${id} returning *`;
    await tx`insert into ops.request_events ${tx({ requestId: id, action: input.action, fromStatus: r.status, toStatus: res.to ?? r.status, actorId: u.id, note: input.note?.trim() || null })}`;
    return row;
  });
  await logActivity({ actorId: u.id, action: `${actionVerb(input.action)} request`, detail: `${updated.number} · ${updated.title}`, area: "REQUESTS", entityType: "InternalRequest", entityId: id, href: `/ops/requests/view?id=${id}`, campusId: updated.campusId });
  return updated;
}

export async function addRequestComment(u: U, id: string, body: string, internal: boolean) {
  const { roles } = await loadRequestFor(u, id);
  const staffSide = roles.includes("handler") || roles.includes("approver");
  if (internal && !staffSide) throw new HttpError(403, "Only the handling team can add internal notes.");
  const [c] = await sql`insert into ops.request_comments ${sql({ requestId: id, authorId: u.id, body: body.trim(), internal })} returning *`;
  return c;
}
