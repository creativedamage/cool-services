/**
 * Domain-level interface over Planning Center. Routes depend only on this, so the live
 * implementation (LivePco) and the in-memory demo (DemoPco) are interchangeable.
 */
import type {
  Board, Candidate, CheckInLocation, CheckInRow, CheckInsForPlan, Conflict, Note, PlanCounts, PlanDetail, PlanSummary, Person, RosterStatus,
  ScheduleRequest, ServiceType, StaffMe, TeamMember, WorkflowCard, WorkflowSummary,
} from "../../../shared/types.js";

export interface PcoApi {
  me(): Promise<StaffMe>;

  // People / workflows
  listWorkflows(): Promise<WorkflowSummary[]>;
  getBoard(workflowId: string): Promise<Board>;
  /** Move to `toStepId` (null = complete the card). `skip` marks intermediate steps skipped. */
  moveCard(workflowId: string, cardId: string, toStepId: string | null, skip?: boolean, personId?: string): Promise<WorkflowCard>;
  /** Email + phone for board cards, loaded after the board itself. */
  getContacts(personIds: string[]): Promise<Record<string, { email: string | null; phone: string | null }>>;
  getPerson(personId: string): Promise<Person>;
  getNotes(personId: string, cardId: string): Promise<Note[]>;
  addCardNote(personId: string, cardId: string, body: string): Promise<Note>;
  sendCardEmail(personId: string, cardId: string, subject: string, body: string): Promise<void>;

  // Services
  listServiceTypes(): Promise<ServiceType[]>;
  listUpcomingPlans(serviceTypeId?: string): Promise<PlanSummary[]>;
  getPlan(serviceTypeId: string, planId: string): Promise<PlanDetail>;
  getPlanCounts(serviceTypeId: string, planId: string): Promise<PlanCounts>;
  /** Everyone checked in (Planning Center Check-Ins) around this plan's service times. */
  getCheckIns(serviceTypeId: string, planId: string): Promise<CheckInsForPlan>;
  /** Everyone checked in today (for the Kids and Nursery iPad pages). */
  getTodayCheckIns(): Promise<CheckInRow[]>;
  /** Rooms in Check-Ins (from current events), for choosing each ministry's rooms. */
  listCheckInLocations(): Promise<CheckInLocation[]>;
  getCandidates(serviceTypeId: string, planId: string, teamId: string, positionName: string): Promise<Candidate[]>;
  getConflicts(serviceTypeId: string, planId: string, personId: string): Promise<Conflict[]>;
  schedule(serviceTypeId: string, planId: string, req: ScheduleRequest): Promise<TeamMember>;
  setStatus(serviceTypeId: string, planId: string, teamMemberId: string, status: RosterStatus, reason?: string): Promise<TeamMember>;
  removeMember(serviceTypeId: string, planId: string, teamMemberId: string): Promise<void>;
}

/* Shared conflict logic, used by both implementations. */
export function computeConflicts(input: {
  planId: string;
  planDay: string; // YYYY-MM-DD
  serviceWindows: { start: number; end: number }[];
  alreadyOnPlan?: { positionName: string } | null;
  blockouts: { start: string; end: string; reason: string | null }[];
  schedules: { planId: string; day: string; label: string; status: RosterStatus }[];
}): Conflict[] {
  const out: Conflict[] = [];
  if (input.alreadyOnPlan) out.push({ kind: "same_plan", label: `Already serving as ${input.alreadyOnPlan.positionName}` });

  const windows = input.serviceWindows.length
    ? input.serviceWindows
    : [{ start: Date.parse(`${input.planDay}T00:00:00`), end: Date.parse(`${input.planDay}T23:59:59`) }];
  for (const b of input.blockouts) {
    const bs = Date.parse(b.start), be = Date.parse(b.end);
    if (windows.some((w) => bs <= w.end && be >= w.start)) {
      out.push({ kind: "blockout", label: `Blocked out${b.reason ? `: ${b.reason}` : ""}` });
      break;
    }
  }
  for (const s of input.schedules) {
    if (s.planId !== input.planId && s.day === input.planDay && s.status !== "D") {
      out.push({ kind: "double_booked", label: `Also scheduled: ${s.label}` });
    }
  }
  return out;
}
