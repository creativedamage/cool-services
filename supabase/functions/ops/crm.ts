/**
 * AVL CRM: leads (a board of possible jobs) and activity — notes, calls, emails, meetings, site
 * visits and follow-ups — on leads, clients and jobs. See lib/crm.ts for the shapes.
 */
import { z } from "zod";
import { DEFAULT_SOURCES, OPEN_STAGES, stageIndex, stageLabel, type Activity, type FollowUps, type LeadDetail, type LeadRow, type LeadStage, type SourceRow } from "./lib/crm.ts";
import { HttpError, sql, type Tx } from "./db.ts";

type Db = typeof sql | Tx;
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const day = (d: unknown) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const ref = (id: unknown, name: unknown) => (id ? { id: id as string, name: (name as string) ?? "" } : null);

/* ───────────── Leads ───────────── */

export async function leadRows(where: unknown, limit = 1000, db: Db = sql): Promise<(LeadRow & { notes: string | null; customerId: string | null; ownerId: string | null; createdBy: string | null; createdById: string | null })[]> {
  const rows = await db`
    select l.*, c.name as customer_name, o.name as owner_name, q.number as quote_number, q.status as quote_status, j.number as job_number,
      cb.name as created_by_name, f.id as fu_id, f.body as fu_body, f.due_at as fu_due
    from ops.leads l
    left join ops.customers c on c.id = l.customer_id
    left join ops.users o on o.id = l.owner_id
    left join ops.users cb on cb.id = l.created_by_id
    left join ops.quotes q on q.id = l.quote_id
    left join ops.jobs j on j.id = l.job_id
    left join lateral (
      select a.id, a.body, a.due_at from ops.activities a where a.lead_id = l.id and a.due_at is not null and a.done_at is null order by a.due_at limit 1
    ) f on true
    where ${where as never}
    order by l.position, l.created_at desc
    limit ${limit}`;
  return rows.map((l) => ({
    id: l.id, title: l.title, stage: l.stage as LeadStage,
    customer: ref(l.customerId, l.customerName), orgName: l.orgName, contactName: l.contactName, contactEmail: l.contactEmail, contactPhone: l.contactPhone,
    city: l.city, state: l.state, valueCents: Number(l.valueCents), source: l.source, owner: ref(l.ownerId, l.ownerName), expectedClose: day(l.expectedClose),
    quote: l.quoteId ? { id: l.quoteId, number: l.quoteNumber, status: l.quoteStatus } : null,
    job: l.jobId ? { id: l.jobId, number: l.jobNumber } : null,
    lostReason: l.lostReason, position: Number(l.position),
    nextFollowUp: l.fuId ? { id: l.fuId, body: l.fuBody, dueAt: iso(l.fuDue)! } : null,
    wonAt: iso(l.wonAt), lostAt: iso(l.lostAt), createdAt: iso(l.createdAt)!, updatedAt: iso(l.updatedAt)!,
    notes: l.notes, customerId: l.customerId, ownerId: l.ownerId, createdBy: l.createdByName ?? null, createdById: l.createdById ?? null,
  }));
}

export async function leadDetail(id: string, db: Db = sql): Promise<LeadDetail> {
  const [l] = await leadRows(sql`l.id = ${id}`, 1, db);
  if (!l) throw new HttpError(404, "Lead not found");
  return l;
}

const opt = (n = 200) => z.string().trim().max(n).nullish().transform((v) => v || null);
const optId = z.string().max(60).nullish().or(z.literal("")).transform((v) => v || null);
export const LeadSchema = z.object({
  title: z.string().trim().min(1, "Give the lead a name, like “Sanctuary audio upgrade”.").max(200),
  customerId: optId,
  orgName: opt(), contactName: opt(), contactEmail: z.string().trim().email("That email doesn’t look right.").max(200).nullish().or(z.literal("")).transform((v) => v || null),
  contactPhone: opt(50), city: opt(100), state: opt(50),
  valueCents: z.number().int().min(0).max(10_000_000_000).default(0),
  source: opt(80), ownerId: optId,
  expectedClose: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")).transform((v) => v || null),
  notes: opt(20_000),
});

/** The top of a stage's column. */
async function topOf(stage: LeadStage, db: Db) {
  const [{ p }] = await db`select coalesce(min(position), 1) - 1 as p from ops.leads where stage = ${stage}`;
  return Number(p);
}

export async function createLead(input: z.infer<typeof LeadSchema>, userId: string, extra: { note?: string | null; followUp?: { body: string; dueAt: string } | null } = {}) {
  return sql.begin(async (tx) => {
    const [l] = await tx`insert into ops.leads ${tx({ ...input, ownerId: input.ownerId ?? userId, createdById: userId, position: await topOf("NEW", tx) })} returning id`;
    if (extra.note?.trim()) await tx`insert into ops.activities ${tx({ kind: "NOTE", body: extra.note.trim(), leadId: l.id, createdById: userId })}`;
    if (extra.followUp) await tx`insert into ops.activities ${tx({ kind: "TASK", body: extra.followUp.body, dueAt: new Date(extra.followUp.dueAt), leadId: l.id, assignedToId: input.ownerId ?? userId, createdById: userId })}`;
    return l.id as string;
  });
}

/** Move a lead to a stage (and a place in its column), noting the change on its timeline. */
export async function moveLead(db: Db, id: string, stage: LeadStage, opts: { position?: number | null; userId?: string | null; note?: string | null; lostReason?: string | null } = {}) {
  const [cur] = await db`select stage from ops.leads where id = ${id} for update`;
  if (!cur) throw new HttpError(404, "Lead not found");
  const data: Record<string, unknown> = { stage, updatedAt: new Date(), position: opts.position ?? (cur.stage === stage ? undefined : await topOf(stage, db)) };
  if (data.position === undefined) delete data.position;
  if (cur.stage !== stage) {
    data.wonAt = stage === "WON" ? new Date() : null;
    data.lostAt = stage === "LOST" ? new Date() : null;
    if (stage !== "LOST") data.lostReason = null;
  }
  if (stage === "LOST" && opts.lostReason !== undefined) data.lostReason = opts.lostReason || null;
  await db`update ops.leads set ${db(data)} where id = ${id}`;
  if (cur.stage !== stage) {
    const why = stage === "LOST" && opts.lostReason ? ` — ${opts.lostReason}` : opts.note ? ` — ${opts.note}` : "";
    await db`insert into ops.activities ${db({ kind: "STAGE", body: `${stageLabel(cur.stage)} → ${stageLabel(stage)}${why}`, leadId: id, createdById: opts.userId ?? null })}`;
  }
}

/**
 * A lead follows its proposal: sending it moves an earlier lead to "Proposal sent", the client
 * accepting it moves the lead to Won. Called inside the proposal's own transaction.
 */
export async function leadFollowsQuote(tx: Tx, quoteId: string, event: string, number: string) {
  const leads = await tx`select id, stage from ops.leads where quote_id = ${quoteId} and stage not in ('WON', 'LOST')`;
  for (const l of leads) {
    if (event === "SEND" && stageIndex(l.stage) < stageIndex("PROPOSAL")) await moveLead(tx, l.id, "PROPOSAL", { note: `${number} sent` });
    if (["ACCEPT", "MARK_ACCEPTED", "CONVERT"].includes(event)) await moveLead(tx, l.id, "WON", { note: `${number} accepted` });
  }
}
/** A job made from a lead's proposal belongs to the lead too. */
export async function leadGetsJob(quoteId: string, jobId: string) {
  await sql`update ops.leads set job_id = ${jobId}, updated_at = now() where quote_id = ${quoteId} and job_id is null`;
}

/**
 * The lead's client: the one it has, or one made from the prospect's details (reusing a client
 * with the same name rather than making a second).
 */
export async function ensureClient(id: string): Promise<string> {
  const [l] = await sql`select * from ops.leads where id = ${id}`;
  if (!l) throw new HttpError(404, "Lead not found");
  if (l.customerId) return l.customerId;
  const name = (l.orgName as string | null)?.trim();
  if (!name) throw new HttpError(422, "Add the church’s name to the lead first.");
  return sql.begin(async (tx) => {
    let [c] = await tx`select id from ops.customers where lower(name) = lower(${name}) order by active desc limit 1`;
    if (!c) {
      [c] = await tx`insert into ops.customers ${tx({ name, city: l.city, state: l.state, email: l.contactEmail, phone: l.contactPhone, contactName: l.contactName })} returning id`;
      if (l.contactName) await tx`insert into ops.customer_contacts ${tx({ customerId: c.id, name: l.contactName, email: l.contactEmail, phone: l.contactPhone, isPrimary: true })}`;
    }
    await tx`update ops.leads set customer_id = ${c.id}, updated_at = now() where id = ${id}`;
    return c.id as string;
  });
}

export async function sourcesInUse(): Promise<string[]> {
  const used = await sql`select distinct source from ops.leads where source is not null order by source`;
  const all = [...DEFAULT_SOURCES];
  for (const r of used) if (!all.some((s) => s.toLowerCase() === String(r.source).toLowerCase())) all.push(r.source);
  return all;
}

/** Won-by-source since a date: leads created since then, grouped by where they came from. */
export async function sourceReport(since: string): Promise<{ sources: SourceRow[]; total: SourceRow }> {
  const rows = await sql`
    select coalesce(nullif(trim(source), ''), 'Not set') as source, count(*)::int as leads,
      count(*) filter (where stage in ${sql(OPEN_STAGES)})::int as open,
      count(*) filter (where stage = 'WON')::int as won, count(*) filter (where stage = 'LOST')::int as lost,
      coalesce(sum(value_cents) filter (where stage = 'WON'), 0)::bigint as won_cents
    from ops.leads where created_at >= ${since}::date group by 1 order by won_cents desc, leads desc`;
  const mk = (r: { source: string; leads: number; open: number; won: number; lost: number; wonCents: number }): SourceRow => ({
    ...r, wonCents: Number(r.wonCents), winRateBps: r.won + r.lost > 0 ? Math.round((r.won / (r.won + r.lost)) * 10_000) : 0,
  });
  const sources = rows.map((r) => mk(r as never));
  const total = mk(sources.reduce((t, r) => ({ source: "All sources", leads: t.leads + r.leads, open: t.open + r.open, won: t.won + r.won, lost: t.lost + r.lost, wonCents: t.wonCents + r.wonCents }),
    { source: "All sources", leads: 0, open: 0, won: 0, lost: 0, wonCents: 0 }));
  return { sources, total };
}

/* ───────────── Activity ───────────── */

export async function activityRows(where: unknown, opts: { limit?: number; order?: "recent" | "due" } = {}): Promise<Activity[]> {
  const rows = await sql`
    select a.*, l.title as lead_title, c.name as customer_name, j.number as job_number, j.name as job_name, at.name as assigned_name, cb.name as created_name
    from ops.activities a
    left join ops.leads l on l.id = a.lead_id
    left join ops.customers c on c.id = a.customer_id
    left join ops.jobs j on j.id = a.job_id
    left join ops.users at on at.id = a.assigned_to_id
    left join ops.users cb on cb.id = a.created_by_id
    where ${where as never}
    order by ${opts.order === "due" ? sql`a.due_at, a.created_at` : sql`a.created_at desc`}
    limit ${opts.limit ?? 300}`;
  return rows.map((a) => ({
    id: a.id, kind: a.kind, body: a.body,
    lead: a.leadId ? { id: a.leadId, title: a.leadTitle } : null,
    customer: ref(a.customerId, a.customerName),
    job: a.jobId ? { id: a.jobId, number: a.jobNumber, name: a.jobName } : null,
    dueAt: iso(a.dueAt), doneAt: iso(a.doneAt), assignedTo: ref(a.assignedToId, a.assignedName), createdBy: ref(a.createdById, a.createdName),
    createdAt: iso(a.createdAt)!,
  }));
}

/** Everything about a client: its own activity plus its leads' and jobs'. */
export const clientActivityWhere = (customerId: string) => sql`(a.customer_id = ${customerId}
  or a.lead_id in (select id from ops.leads where customer_id = ${customerId})
  or a.job_id in (select id from ops.jobs where customer_id = ${customerId}))`;

const dueDate = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)).nullish().or(z.literal("")).transform((v) => v || null);
export const ActivitySchema = z.object({
  kind: z.enum(["NOTE", "CALL", "EMAIL", "MEETING", "SITE_VISIT", "TASK"]),
  body: z.string().trim().max(20_000).default(""),
  leadId: optId, customerId: optId, jobId: optId,
  dueAt: dueDate, assignedToId: optId,
}).refine((a) => a.leadId || a.customerId || a.jobId, "Say what this is about: a lead, client or job.")
  .refine((a) => a.body || a.kind !== "NOTE", "Write the note first.")
  .refine((a) => a.kind !== "TASK" || a.dueAt, "Pick a date for the follow-up.");

/** "2026-10-20" means that day (noon, so every time zone agrees on the date); a full time stays as given. */
export const dueAtDate = (v: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v);

/** Open follow-ups, split by when they're due (in the server's day; the page re-buckets in local time). */
export async function followUps(where: unknown): Promise<FollowUps> {
  const rows = await activityRows(sql`a.due_at is not null and a.done_at is null and a.due_at < now() + interval '14 days' and ${where as never}`, { order: "due", limit: 100 });
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86_400_000);
  return {
    overdue: rows.filter((a) => new Date(a.dueAt!) < start),
    today: rows.filter((a) => new Date(a.dueAt!) >= start && new Date(a.dueAt!) < end),
    upcoming: rows.filter((a) => new Date(a.dueAt!) >= end),
  };
}
