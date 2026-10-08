// Generated from shared/ops/projects.ts by supabase/build-ops.mjs — edit that file instead.
/**
 * Sundays AVL projects: running a job once it's sold. Its schedule (phases on a Gantt), crew,
 * tasks with checklists, daily logs with photos, files, and time.
 *
 * Dates are plain days ("2026-10-20"); times are ISO timestamps. Pure module, shared by the ops
 * Edge Function and the screens.
 */

export type PhaseStatus = "NOT_STARTED" | "IN_PROGRESS" | "DONE";
export const PHASE_STATUSES: { id: PhaseStatus; label: string }[] = [
  { id: "NOT_STARTED", label: "Not started" },
  { id: "IN_PROGRESS", label: "In progress" },
  { id: "DONE", label: "Done" },
];

/** Bar colors (a name, so both themes can draw it their own way). */
export const PHASE_COLORS = ["blue", "violet", "teal", "amber", "rose", "green", "slate"] as const;
export type PhaseColor = (typeof PHASE_COLORS)[number];

/** The usual run of an AVL install, with typical working days for each. */
export const STANDARD_PHASES: { name: string; days: number; color: PhaseColor }[] = [
  { name: "Design", days: 5, color: "violet" },
  { name: "Order", days: 10, color: "amber" },
  { name: "Pre-wire", days: 3, color: "teal" },
  { name: "Install", days: 5, color: "blue" },
  { name: "Commission", days: 2, color: "rose" },
  { name: "Training", days: 1, color: "green" },
];

export interface Phase {
  id: string; name: string; startDate: string | null; endDate: string | null; status: PhaseStatus;
  color: PhaseColor | null; notes: string | null; people: string[]; sortOrder: number;
}

export interface Person { id: string; name: string }
export interface CrewMember extends Person { avlLevel: string; hourlyCostCents: number | null }

export interface ChecklistItem { id: string; text: string; done: boolean }
export interface JobTask {
  id: string; jobId: string; phaseId: string | null; title: string; notes: string | null;
  assignee: Person | null; dueDate: string | null; checklist: ChecklistItem[];
  doneAt: string | null; doneBy: string | null; createdAt: string;
  /** On lists across jobs. */
  job?: { id: string; number: string; name: string };
}

export interface JobFile {
  id: string; name: string; folder: string | null; mime: string | null; sizeBytes: number;
  dailyLogId: string | null; shared: boolean; uploadedBy: Person | null; createdAt: string;
  /** Short-lived links (view in the browser / download with its name). */
  url: string | null; downloadUrl: string | null;
}
export const isImage = (f: { mime: string | null; name: string }) => /^image\//.test(f.mime ?? "") || /\.(jpe?g|png|gif|webp|heic)$/i.test(f.name);

export interface DailyLog {
  id: string; logDate: string; author: Person | null; notes: string; issues: string | null;
  crewCount: number | null; hoursOnSite: number | null; photos: JobFile[];
  createdAt: string; updatedAt: string; canEdit: boolean;
}

export interface TimeEntry {
  id: string; jobId: string; job?: { id: string; number: string; name: string };
  phaseId: string | null; phaseName: string | null; user: Person; workDate: string;
  startedAt: string | null; endedAt: string | null; minutes: number; note: string | null;
  /** What the time cost (hidden from crew). */
  costCents: number | null;
  approvedAt: string | null; approvedBy: string | null; running: boolean; canEdit: boolean;
}

/** A running clock: minutes so far. */
export const runningMinutes = (startedAt: string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000));
export const fmtHours = (minutes: number) => {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};
/** "2.5" or "2:30" or "2h 30m" → minutes (null when it can't be read). */
export function parseHours(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{1,2}):(\d{2})$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = t.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/)) && (m[1] || m[2])) return Math.round(Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0);
  if ((m = t.match(/^\d+(?:\.\d+)?$/))) return Math.round(Number(t) * 60);
  return null;
}

/* ───────────── Days ───────────── */

export const toDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseDay = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (s: string, n: number) => { const d = parseDay(s); d.setDate(d.getDate() + n); return toDay(d); };
export const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
const weekend = (s: string) => [0, 6].includes(parseDay(s).getDay());
/** n working days on from `s` (s counts as the first), skipping weekends. */
export function addWorkdays(s: string, n: number) {
  let d = s;
  while (weekend(d)) d = addDays(d, 1);
  for (let left = n - 1; left > 0;) { d = addDays(d, 1); if (!weekend(d)) left--; }
  return d;
}
/** The standard phases laid end to end from `start`, on working days. */
export function standardSchedule(start: string): Omit<Phase, "id" | "sortOrder">[] {
  let at = start;
  return STANDARD_PHASES.map((p) => {
    const s = addWorkdays(at, 1), e = addWorkdays(s, p.days);
    at = addDays(e, 1);
    return { name: p.name, startDate: s, endDate: e, status: "NOT_STARTED", color: p.color, notes: null, people: [] };
  });
}
/** Is the phase on this day? */
export const phaseOn = (p: Pick<Phase, "startDate" | "endDate">, day: string) => !!p.startDate && p.startDate <= day && (p.endDate ?? p.startDate) >= day;

/* ───────────── Pages ───────────── */

export interface ProjectInfo {
  phases: Phase[];
  crew: CrewMember[];
  /** Hours sold as labor in the budget (items costed as labor, by the hour). */
  budgetedLaborMinutes: number | null;
  loggedMinutes: number;
  openTasks: number;
}

export interface ScheduleItem {
  job: { id: string; number: string; name: string; status: string; city: string | null };
  phase: Phase;
}
export interface SchedulePage {
  from: string; to: string;
  items: ScheduleItem[];
  /** Tasks due in the range. */
  tasks: JobTask[];
  people: Person[];
  /** Jobs that are open, for "add a phase" without a phase yet. */
  jobs: { id: string; number: string; name: string }[];
  canEdit: boolean;
}

export interface MyWork {
  tasks: JobTask[];
  today: ScheduleItem[];
  clock: TimeEntry | null;
  /** Minutes logged this week (Monday on). */
  weekMinutes: number;
  jobs: { id: string; number: string; name: string; phases: { id: string; name: string }[] }[];
}

export interface Timesheet {
  from: string; to: string;
  entries: TimeEntry[];
  people: Person[];
  jobs: { id: string; number: string; name: string; phases: { id: string; name: string }[] }[];
  /** AVL Managers: approve and edit anyone's time. */
  canApprove: boolean;
  seesCost: boolean;
}
