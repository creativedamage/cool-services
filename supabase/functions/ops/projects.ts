/**
 * AVL projects: a job's schedule (phases), crew, tasks, daily logs, files and time.
 *
 * Who sees what: AVL Techs and Managers see every job. AVL Crew see only the jobs they're on (the
 * job's crew, or its project manager) and never money: no budget, no prices, no time costs. Crew
 * can tick tasks, write daily logs, add files and photos, and log their own time.
 */
import { z } from "zod";
import { hasAvlAccess, hasAvlField, isAvlManager } from "./lib/rbac.ts";
import type { OpsSessionUser } from "./lib/types.ts";
import type { ChecklistItem, CrewMember, DailyLog, JobFile, JobTask, Phase, PhaseColor, PhaseStatus, ProjectInfo, ScheduleItem, TimeEntry } from "./lib/projects.ts";
import { afterCommit, HttpError, orgId, sql, type Tx } from "./db.ts";
import { readLinks, removeFiles, safeName, stat, uploadLink } from "./storage.ts";

type U = OpsSessionUser;
type Db = typeof sql | Tx;

const day = (d: unknown) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const rid = (p: string) => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return p + Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 20);
};
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = dateStr.nullish().or(z.literal("")).transform((v) => v || null);
const optText = (n: number) => z.string().trim().max(n).nullish().transform((v) => v || null);
const optId = z.string().max(60).nullish().or(z.literal("")).transform((v) => v || null);

/* ───────────── Access ───────────── */

/** Jobs a crew member is on (as SQL on ops.jobs j). */
export const crewJobsWhere = (u: U) => sql`(j.manager_id = ${u.id} or exists (select 1 from ops.job_crew c where c.job_id = j.id and c.user_id = ${u.id}))`;

/** Can this person open the job? `crew` = they see it as crew (no money, can't run it). */
export async function jobAccess(u: U, jobId: string): Promise<{ crew: boolean; job: { id: string; number: string; name: string } }> {
  if (!hasAvlField(u)) throw new HttpError(403, "AVL access required");
  const crew = !hasAvlAccess(u);
  const [j] = await sql`select j.id, j.number, j.name from ops.jobs j where j.id = ${jobId} ${crew ? sql`and ${crewJobsWhere(u)}` : sql``}`;
  if (!j) throw new HttpError(404, "Job not found");
  return { crew, job: j as { id: string; number: string; name: string } };
}
/** Run the job (schedule, crew, tasks): AVL Techs and Managers. */
export async function jobManage(u: U, jobId: string) {
  const a = await jobAccess(u, jobId);
  if (a.crew) throw new HttpError(403, "Only AVL Techs and Managers can change that.");
  return a;
}

/* ───────────── Crew ───────────── */

export async function crewOf(jobId: string, db: Db = sql): Promise<CrewMember[]> {
  const rows = await db`select u.id, u.name, u.avl_level, u.hourly_cost_cents from ops.job_crew c join ops.users u on u.id = c.user_id where c.job_id = ${jobId} order by u.name`;
  return rows.map((r) => ({ id: r.id, name: r.name, avlLevel: r.avlLevel, hourlyCostCents: r.hourlyCostCents ?? null }));
}
/** Put people on the job (people already on it stay). */
export async function addToCrew(jobId: string, userIds: (string | null | undefined)[], db: Db = sql) {
  const ids = [...new Set(userIds.filter(Boolean) as string[])];
  if (!ids.length) return;
  const ok = await db`select id from ops.users where id = any(${ids}) and active and not pending`;
  if (!ok.length) return;
  await db`insert into ops.job_crew ${db(ok.map((u) => ({ jobId, userId: u.id })))} on conflict do nothing`;
}
export async function setCrew(jobId: string, userIds: string[]) {
  return sql.begin(async (tx) => {
    await tx`delete from ops.job_crew where job_id = ${jobId} ${userIds.length ? tx`and user_id <> all(${userIds})` : tx``}`;
    await addToCrew(jobId, userIds, tx);
    return crewOf(jobId, tx);
  });
}
/** Everyone who can be put on a job: anyone with AVL (crew included). */
export async function assignable(extra: (string | null)[] = []) {
  const ids = extra.filter(Boolean) as string[];
  return await sql`select id, name, avl_level from ops.users where source <> 'PLATFORM' and not pending and
    ((active and (avl_level <> 'NONE' or synced_avl_level in ('CREW','TECH','MANAGER') or role = 'ADMIN')) ${ids.length ? sql`or id = any(${ids})` : sql``})
    order by name` as unknown as { id: string; name: string; avlLevel: string }[];
}

/* ───────────── Phases ───────────── */

// deno-lint-ignore no-explicit-any
const toPhase = (r: Record<string, any>): Phase => ({
  id: r.id, name: r.name, startDate: day(r.startDate), endDate: day(r.endDate), status: r.status as PhaseStatus,
  color: (r.color as PhaseColor) ?? null, notes: r.notes ?? null, people: r.people ?? [], sortOrder: r.sortOrder,
});
export async function phasesOf(jobId: string, db: Db = sql): Promise<Phase[]> {
  return (await db`select * from ops.job_phases where job_id = ${jobId} order by sort_order, start_date nulls last, id`).map(toPhase);
}

export const PhasesSchema = z.array(z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1, "Name each phase.").max(120),
  startDate: optDate, endDate: optDate,
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "DONE"]).default("NOT_STARTED"),
  color: z.enum(["blue", "violet", "teal", "amber", "rose", "green", "slate"]).nullish().transform((v) => v ?? null),
  notes: optText(5000),
  people: z.array(z.string().max(60)).max(50).default([]),
}).refine((p) => !p.startDate || !p.endDate || p.endDate >= p.startDate, "A phase can't end before it starts.")).max(60);

/** Save the job's whole schedule. Phases keep their ids (tasks and time point at them); people on a phase join the crew. */
export async function savePhases(jobId: string, input: z.infer<typeof PhasesSchema>) {
  return sql.begin(async (tx) => {
    const have = new Set((await tx`select id from ops.job_phases where job_id = ${jobId}`).map((r) => r.id as string));
    const rows = input.map((p, i) => ({
      id: have.has(p.id) ? p.id : rid("ph"), jobId, name: p.name, startDate: p.startDate ?? (p.endDate || null), endDate: p.endDate ?? p.startDate ?? null,
      status: p.status, color: p.color, notes: p.notes, people: [...new Set(p.people)], sortOrder: i,
    }));
    const keep = rows.map((r) => r.id);
    await tx`delete from ops.job_phases where job_id = ${jobId} ${keep.length ? tx`and id <> all(${keep})` : tx``}`;
    if (rows.length) {
      await tx`insert into ops.job_phases ${tx(rows)} on conflict (id) do update set name = excluded.name, start_date = excluded.start_date,
        end_date = excluded.end_date, status = excluded.status, color = excluded.color, notes = excluded.notes, people = excluded.people, sort_order = excluded.sort_order`;
    }
    await addToCrew(jobId, rows.flatMap((r) => r.people), tx);
    // The job's dates follow its schedule when it has one.
    const dated = rows.filter((r) => r.startDate);
    if (dated.length) {
      const start = dated.map((r) => r.startDate!).sort()[0], end = dated.map((r) => r.endDate ?? r.startDate!).sort().at(-1)!;
      await tx`update ops.jobs set start_date = ${start}, end_date = ${end}, updated_at = now() where id = ${jobId}`;
    }
    return phasesOf(jobId, tx);
  });
}

export async function projectInfo(jobId: string, crew: boolean): Promise<ProjectInfo> {
  const [phases, members, [labor], [logged], [open]] = await Promise.all([
    phasesOf(jobId), crewOf(jobId),
    sql`select sum(round(quantity * 60))::int as m, count(*)::int as n from ops.budget_items where job_id = ${jobId} and kind = 'ITEM' and cost_type = 'LABOR' and lower(coalesce(unit, '')) in ('hr', 'hrs', 'hour', 'hours', 'h')`,
    sql`select coalesce(sum(minutes), 0)::int as m from ops.time_entries where job_id = ${jobId}`,
    sql`select count(*)::int as n from ops.job_tasks where job_id = ${jobId} and done_at is null`,
  ]);
  return {
    phases, crew: crew ? members.map((m) => ({ ...m, hourlyCostCents: null })) : members,
    budgetedLaborMinutes: labor?.n ? labor.m : null, loggedMinutes: logged.m, openTasks: open.n,
  };
}

/* ───────────── Tasks ───────────── */

export async function taskRows(where: unknown, limit = 500): Promise<JobTask[]> {
  const rows = await sql`select t.*, a.name as assignee_name, d.name as done_by_name, j.number as job_number, j.name as job_name
    from ops.job_tasks t join ops.jobs j on j.id = t.job_id
    left join ops.users a on a.id = t.assignee_id left join ops.users d on d.id = t.done_by_id
    where ${where as never}
    order by (t.done_at is not null), t.done_at desc nulls first, t.due_date nulls last, t.sort_order, t.created_at
    limit ${limit}`;
  return rows.map((t) => ({
    id: t.id, jobId: t.jobId, phaseId: t.phaseId ?? null, title: t.title, notes: t.notes ?? null,
    assignee: t.assigneeId ? { id: t.assigneeId, name: t.assigneeName } : null, dueDate: day(t.dueDate),
    checklist: (t.checklist ?? []) as ChecklistItem[], doneAt: iso(t.doneAt), doneBy: t.doneByName ?? null, createdAt: iso(t.createdAt)!,
    job: { id: t.jobId, number: t.jobNumber, name: t.jobName },
  }));
}
const Checklist = z.array(z.object({ id: z.string().max(40).optional(), text: z.string().trim().min(1).max(500), done: z.boolean().default(false) })).max(100)
  .transform((l) => l.map((i) => ({ id: i.id || rid("c"), text: i.text, done: i.done })));
export const TaskSchema = z.object({
  title: z.string().trim().min(1, "Name the task.").max(300), notes: optText(10_000),
  phaseId: optId, assigneeId: optId, dueDate: optDate, checklist: Checklist.default([]),
});
async function checkPhase(jobId: string, phaseId: string | null) {
  if (!phaseId) return;
  const [p] = await sql`select 1 from ops.job_phases where id = ${phaseId} and job_id = ${jobId}`;
  if (!p) throw new HttpError(422, "That phase isn't on this job.");
}
export async function createTask(jobId: string, input: z.infer<typeof TaskSchema>, userId: string) {
  await checkPhase(jobId, input.phaseId);
  const [{ n }] = await sql`select coalesce(max(sort_order), 0) + 1 as n from ops.job_tasks where job_id = ${jobId}`;
  const [t] = await sql`insert into ops.job_tasks ${sql({ ...input, checklist: sql.json(input.checklist), jobId, sortOrder: n, createdById: userId })} returning id`;
  await addToCrew(jobId, [input.assigneeId]);
  return (await taskRows(sql`t.id = ${t.id}`, 1))[0];
}
export async function updateTask(id: string, jobId: string, input: z.infer<typeof TaskSchema>) {
  await checkPhase(jobId, input.phaseId);
  await sql`update ops.job_tasks set ${sql({ ...input, checklist: sql.json(input.checklist), updatedAt: new Date() })} where id = ${id}`;
  await addToCrew(jobId, [input.assigneeId]);
  return (await taskRows(sql`t.id = ${id}`, 1))[0];
}
/** Tick or untick a task, or items on its checklist (anyone on the job). */
export async function tickTask(id: string, userId: string, p: { done?: boolean; checklist?: { id: string; done: boolean }[] }) {
  return sql.begin(async (tx) => {
    const [t] = await tx`select * from ops.job_tasks where id = ${id} for update`;
    if (!t) throw new HttpError(404, "Task not found");
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (p.checklist) {
      const set = new Map(p.checklist.map((c) => [c.id, c.done]));
      patch.checklist = tx.json((t.checklist as ChecklistItem[]).map((c) => (set.has(c.id) ? { ...c, done: set.get(c.id)! } : c)) as never);
    }
    if (p.done !== undefined) Object.assign(patch, p.done ? { doneAt: t.doneAt ?? new Date(), doneById: t.doneById ?? userId } : { doneAt: null, doneById: null });
    await tx`update ops.job_tasks set ${tx(patch)} where id = ${id}`;
    return true;
  }).then(async () => (await taskRows(sql`t.id = ${id}`, 1))[0]);
}

/* ───────────── Files ───────────── */

// deno-lint-ignore no-explicit-any
export async function fileRows(where: unknown, links = true): Promise<(JobFile & { path: string })[]> {
  const rows = await sql`select f.*, u.name as uploaded_by_name from ops.job_files f left join ops.users u on u.id = f.uploaded_by_id
    where f.ready and ${where as never} order by f.created_at desc limit 1000`;
  const signed = links ? await readLinks(rows.map((r) => ({ path: r.path, name: r.name }))) : new Map();
  return rows.map((f) => ({
    id: f.id, name: f.name, folder: f.folder ?? null, mime: f.mime ?? null, sizeBytes: Number(f.sizeBytes), dailyLogId: f.dailyLogId ?? null, shared: f.shared,
    uploadedBy: f.uploadedById ? { id: f.uploadedById, name: f.uploadedByName } : null, createdAt: iso(f.createdAt)!,
    url: signed.get(f.path)?.url ?? null, downloadUrl: signed.get(f.path)?.downloadUrl ?? null, path: f.path,
  }));
}
export const strip = <T extends { path: string }>(f: T): Omit<T, "path"> => { const { path: _p, ...rest } = f; return rest; };

export const UploadSchema = z.object({
  name: z.string().trim().min(1).max(200), mime: z.string().max(120).nullish().transform((v) => v || null),
  sizeBytes: z.number().int().min(0).max(100 * 1024 * 1024, "Files can be up to 100 MB."),
  folder: optText(80), dailyLogId: optId,
});
/** Step one of an upload: the file's row (not ready yet) and a link to PUT it to. */
export async function startUpload(jobId: string, input: z.infer<typeof UploadSchema>, userId: string) {
  if (input.dailyLogId) {
    const [l] = await sql`select 1 from ops.daily_logs where id = ${input.dailyLogId} and job_id = ${jobId}`;
    if (!l) throw new HttpError(422, "That daily log isn't on this job.");
  }
  // Uploads that never finished (a day old) are cleared out.
  const stale = await sql`delete from ops.job_files where job_id = ${jobId} and not ready and created_at < now() - interval '1 day' returning path`;
  if (stale.length) afterCommit(() => removeFiles(stale.map((s) => s.path as string)));
  const id = rid("f");
  const path = `${orgId()}/${jobId}/${id}/${safeName(input.name)}`;
  const url = await uploadLink(path);
  await sql`insert into ops.job_files ${sql({ id, jobId, name: input.name, mime: input.mime, sizeBytes: input.sizeBytes, folder: input.folder, dailyLogId: input.dailyLogId, path, uploadedById: userId })}`;
  return { id, uploadUrl: url };
}
/** Step two: the browser says it's done; we check Storage has it. */
export async function finishUpload(id: string) {
  const [f] = await sql`select * from ops.job_files where id = ${id}`;
  if (!f) throw new HttpError(404, "File not found");
  if (!f.ready) {
    const s = await stat(f.path);
    if (!s) throw new HttpError(409, "The upload didn't arrive. Try again.");
    await sql`update ops.job_files set ready = true, size_bytes = ${s.size || f.sizeBytes}, mime = coalesce(mime, ${s.mime}) where id = ${id}`;
  }
  return strip((await fileRows(sql`f.id = ${id}`))[0]);
}
export async function deleteFiles(where: unknown) {
  const gone = await sql`delete from ops.job_files f where ${where as never} returning path`;
  // Only once the rows are really gone.
  if (gone.length) afterCommit(() => removeFiles(gone.map((g) => g.path as string)));
  return gone.length;
}

/* ───────────── Daily logs ───────────── */

export async function logRows(jobId: string, u: U, crew: boolean, limit = 200): Promise<DailyLog[]> {
  const rows = await sql`select l.*, u.name as author_name from ops.daily_logs l left join ops.users u on u.id = l.author_id
    where l.job_id = ${jobId} order by l.log_date desc, l.created_at desc limit ${limit}`;
  const photos = rows.length ? await fileRows(sql`f.daily_log_id = any(${rows.map((r) => r.id)})`) : [];
  return rows.map((l) => ({
    id: l.id, logDate: day(l.logDate)!, author: l.authorId ? { id: l.authorId, name: l.authorName } : null, notes: l.notes, issues: l.issues ?? null,
    crewCount: l.crewCount ?? null, hoursOnSite: l.hoursOnSite == null ? null : Number(l.hoursOnSite),
    photos: photos.filter((p) => p.dailyLogId === l.id).map(strip).reverse(),
    createdAt: iso(l.createdAt)!, updatedAt: iso(l.updatedAt)!, canEdit: !crew || l.authorId === u.id,
  }));
}
export const LogSchema = z.object({
  logDate: dateStr, notes: z.string().trim().max(20_000).default(""), issues: optText(10_000),
  crewCount: z.number().int().min(0).max(500).nullish().transform((v) => v ?? null),
  hoursOnSite: z.number().min(0).max(24).nullish().transform((v) => v ?? null),
});
export async function canEditLog(u: U, id: string) {
  const [l] = await sql`select job_id, author_id from ops.daily_logs where id = ${id}`;
  if (!l) throw new HttpError(404, "Daily log not found");
  const a = await jobAccess(u, l.jobId);
  if (a.crew && l.authorId !== u.id) throw new HttpError(403, "You can change your own daily logs.");
  return { jobId: l.jobId as string, job: a.job };
}

/* ───────────── Time ───────────── */

export async function timeRows(where: unknown, u: U, seesCost: boolean, limit = 2000): Promise<TimeEntry[]> {
  const rows = await sql`select t.*, u.name as user_name, p.name as phase_name, a.name as approved_by_name, j.number as job_number, j.name as job_name
    from ops.time_entries t join ops.users u on u.id = t.user_id join ops.jobs j on j.id = t.job_id
    left join ops.job_phases p on p.id = t.phase_id left join ops.users a on a.id = t.approved_by_id
    where ${where as never} order by t.work_date desc, t.started_at desc nulls last, t.created_at desc limit ${limit}`;
  const manager = isAvlManager(u);
  return rows.map((t) => {
    const running = !!t.startedAt && !t.endedAt;
    return {
      id: t.id, jobId: t.jobId, job: { id: t.jobId, number: t.jobNumber, name: t.jobName }, phaseId: t.phaseId ?? null, phaseName: t.phaseName ?? null,
      user: { id: t.userId, name: t.userName }, workDate: day(t.workDate)!, startedAt: iso(t.startedAt), endedAt: iso(t.endedAt), minutes: t.minutes, note: t.note ?? null,
      costCents: seesCost ? Math.round((t.minutes / 60) * t.costRateCents) : null,
      approvedAt: iso(t.approvedAt), approvedBy: t.approvedByName ?? null, running,
      canEdit: manager || (t.userId === u.id && !t.approvedAt),
    };
  });
}
async function rateOf(userId: string): Promise<number> {
  const [r] = await sql`select hourly_cost_cents from ops.users where id = ${userId}`;
  return r?.hourlyCostCents ?? 0;
}
export const ClockInSchema = z.object({ jobId: z.string().min(1).max(60), phaseId: optId, workDate: dateStr, note: optText(1000) });
export async function clockIn(u: U, input: z.infer<typeof ClockInSchema>) {
  await jobAccess(u, input.jobId);
  await checkPhase(input.jobId, input.phaseId);
  const [running] = await sql`select t.id, j.number from ops.time_entries t join ops.jobs j on j.id = t.job_id where t.user_id = ${u.id} and t.started_at is not null and t.ended_at is null`;
  if (running) throw new HttpError(409, `You're already clocked in on ${running.number}. Clock out first.`);
  const [t] = await sql`insert into ops.time_entries ${sql({ jobId: input.jobId, phaseId: input.phaseId, userId: u.id, workDate: input.workDate, startedAt: new Date(), note: input.note, costRateCents: await rateOf(u.id) })} returning id`;
  await addToCrew(input.jobId, [u.id]);
  return t.id as string;
}
export async function clockOut(u: U, note?: string | null) {
  const [t] = await sql`select * from ops.time_entries where user_id = ${u.id} and started_at is not null and ended_at is null`;
  if (!t) throw new HttpError(409, "You're not clocked in.");
  const end = new Date();
  const minutes = Math.min(1440, Math.max(0, Math.round((end.getTime() - new Date(t.startedAt).getTime()) / 60_000)));
  await sql`update ops.time_entries set ${sql({ endedAt: end, minutes, note: note ?? t.note, updatedAt: end })} where id = ${t.id}`;
  return t.id as string;
}
export const TimeSchema = z.object({
  jobId: z.string().min(1).max(60), phaseId: optId, workDate: dateStr,
  minutes: z.number().int().min(1, "Enter the time worked.").max(1440, "That's more than a day."), note: optText(1000), userId: optId,
});
/** Time typed in. Managers can log time for anyone; everyone else for themselves. */
export async function addTime(u: U, input: z.infer<typeof TimeSchema>) {
  const who = input.userId ?? u.id;
  if (who !== u.id && !isAvlManager(u)) throw new HttpError(403, "Only an AVL Manager can log time for someone else.");
  if (who === u.id) await jobAccess(u, input.jobId);
  else { const [j] = await sql`select 1 from ops.jobs where id = ${input.jobId}`; if (!j) throw new HttpError(404, "Job not found"); }
  await checkPhase(input.jobId, input.phaseId);
  const [t] = await sql`insert into ops.time_entries ${sql({ jobId: input.jobId, phaseId: input.phaseId, userId: who, workDate: input.workDate, minutes: input.minutes, note: input.note, costRateCents: await rateOf(who) })} returning id`;
  await addToCrew(input.jobId, [who]);
  return t.id as string;
}
export async function editableTime(u: U, id: string) {
  const [t] = await sql`select * from ops.time_entries where id = ${id}`;
  if (!t) throw new HttpError(404, "Time entry not found");
  if (!isAvlManager(u)) {
    if (t.userId !== u.id) throw new HttpError(403, "You can change your own time.");
    if (t.approvedAt) throw new HttpError(403, "That time is approved. An AVL Manager can change it.");
  }
  return t;
}
export async function updateTime(u: U, id: string, input: z.infer<typeof TimeSchema>) {
  const t = await editableTime(u, id);
  if (t.startedAt && !t.endedAt) throw new HttpError(409, "Clock out before changing this time.");
  if (input.jobId !== t.jobId) await jobAccess(u, input.jobId);
  await checkPhase(input.jobId, input.phaseId);
  await sql`update ops.time_entries set ${sql({ jobId: input.jobId, phaseId: input.phaseId, workDate: input.workDate, minutes: input.minutes, note: input.note, updatedAt: new Date() })} where id = ${id}`;
}

/* ───────────── Schedule ───────────── */

export async function scheduleItems(u: U, from: string, to: string, jobId?: string): Promise<ScheduleItem[]> {
  const crew = !hasAvlAccess(u);
  const rows = await sql`select p.*, j.number as job_number, j.name as job_name, j.status as job_status, j.site_city
    from ops.job_phases p join ops.jobs j on j.id = p.job_id
    where p.start_date is not null and p.start_date <= ${to} and coalesce(p.end_date, p.start_date) >= ${from}
      and j.status <> 'CANCELLED' ${crew ? sql`and ${crewJobsWhere(u)}` : sql``} ${jobId ? sql`and j.id = ${jobId}` : sql``}
    order by p.start_date, j.number, p.sort_order`;
  return rows.map((r) => ({ job: { id: r.jobId, number: r.jobNumber, name: r.jobName, status: r.jobStatus, city: r.siteCity ?? null }, phase: toPhase(r) }));
}
