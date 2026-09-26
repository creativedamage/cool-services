import type {
  AppSettings, NdiStatus, Board, Candidate, CheckInsForPlan, Conflict, MicAssignment, MicSetup, Note, PlanCounts, PlanDetail, PlanMics, ReceiverStatus, StagePlot, PlanSummary, RosterStatus, ScheduleRequest,
  ServiceType, StaffMe, TeamMember, WorkflowCard, WorkflowSummary,
  Matrix, RunSheetData, RunSheetLive, CheckInLocation, KioskAddresses, KioskChild, Ministry, MinistryPaging, PageEvent, PagingConfig, PagingStatus, ProMessageOption, ProPresenterMachine, ProThemeOption,
} from "@shared/types";
import type { UpdateStatus } from "@shared/updates";

export type SettingsPatch = Partial<Omit<AppSettings, "ndi" | "waves">> & {
  ndi?: Partial<AppSettings["ndi"]>;
  waves?: Partial<AppSettings["waves"]>;
};

export type PagingPatch = Partial<Omit<PagingConfig, "ministries" | "propresenter" | "ipads">> & {
  propresenter?: Partial<PagingConfig["propresenter"]>;
  ipads?: Partial<PagingConfig["ipads"]>;
  ministries?: Partial<Record<Ministry, Partial<Omit<MinistryPaging, "hasPin">>>>;
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  // Not signed in: go to sign-in (except on the NDI output page, which just waits).
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/" && !window.location.pathname.startsWith("/ndi") && !window.location.pathname.startsWith("/kiosk")) {
    window.location.href = "/";
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.message ?? data?.error ?? res.statusText, data);
  return data as T;
}

/**
 * At most 2 background requests at a time, so they never take all of the browser's connections
 * to the app (it allows 6) and a service you click opens right away.
 */
let lowRunning = 0;
const lowQueue: (() => void)[] = [];
async function lowLane<T>(fn: () => Promise<T>): Promise<T> {
  if (lowRunning >= 2) await new Promise<void>((r) => lowQueue.push(r));
  lowRunning++;
  try { return await fn(); } finally { lowRunning--; lowQueue.shift()?.(); }
}

/** Typed endpoint map — the only place the frontend knows URLs. */
export const Api = {
  me: () => api<StaffMe>("/auth/me"),
  settings: () => api<AppSettings>("/settings"),
  saveSettings: (patch: SettingsPatch) =>
    api<AppSettings>("/settings", { method: "PUT", json: patch }),
  ndiStatus: () => api<NdiStatus>("/settings/ndi-status"),
  version: () => api<{ version: string }>("/health").then((h) => h.version),
  logout: () => api<{ ok: true }>("/auth/logout", { method: "POST" }),

  workflows: () => api<WorkflowSummary[]>("/workflows"),
  board: (wf: string) => api<Board>(`/workflows/${wf}/board`),
  moveCard: (wf: string, card: string, toStepId: string | null, personId?: string) =>
    api<WorkflowCard>(`/workflows/${wf}/cards/${card}/move`, { method: "POST", json: { toStepId, personId } }),
  contacts: (ids: string[]) => api<Record<string, { email: string | null; phone: string | null; mobile: string | null }>>(`/contacts?ids=${ids.join(",")}`),
  notes: (person: string, card: string) => api<Note[]>(`/people/${person}/cards/${card}/notes`),
  addNote: (person: string, card: string, body: string, internal: boolean) =>
    api<Note>(`/people/${person}/cards/${card}/notes`, { method: "POST", json: { body, internal } }),
  email: (person: string, card: string, subject: string, body: string) =>
    api<{ ok: true }>(`/people/${person}/cards/${card}/email`, { method: "POST", json: { subject, body } }),

  serviceTypes: () => api<ServiceType[]>("/services/service-types"),
  plans: (serviceTypeId?: string) =>
    api<PlanSummary[]>(`/services/plans${serviceTypeId ? `?serviceTypeId=${serviceTypeId}` : ""}`),
  plan: (st: string, plan: string) => api<PlanDetail>(`/services/plans/${st}/${plan}`),
  runSheet: (st: string, plan: string) => api<RunSheetData>(`/services/plans/${st}/${plan}/runsheet`),
  live: (st: string, plan: string) => api<{ live: RunSheetLive | null }>(`/services/plans/${st}/${plan}/live`).then((r) => r.live),
  matrix: (st: string, weeks: number, past: number) => api<Matrix>(`/services/matrix/${st}?weeks=${weeks}&past=${past}`),
  checkins: (st: string, plan: string) => api<CheckInsForPlan>(`/services/plans/${st}/${plan}/checkins`),
  // Background work: the server lets requests you're waiting on (opening a service) go first.
  planCounts: (st: string, plan: string) => lowLane(() => api<PlanCounts>(`/services/plans/${st}/${plan}/counts`, { headers: { "X-Priority": "low" } })),
  candidates: (st: string, plan: string, teamId: string, position: string) =>
    api<Candidate[]>(`/services/plans/${st}/${plan}/candidates?teamId=${teamId}&position=${encodeURIComponent(position)}`),
  conflicts: (st: string, plan: string, personId: string) =>
    api<Conflict[]>(`/services/plans/${st}/${plan}/conflicts?personId=${personId}`),
  schedule: (st: string, plan: string, req: ScheduleRequest) =>
    api<TeamMember>(`/services/plans/${st}/${plan}/team-members`, { method: "POST", json: req }),
  setStatus: (st: string, plan: string, tm: string, status: RosterStatus, reason?: string) =>
    api<TeamMember>(`/services/plans/${st}/${plan}/team-members/${tm}`, { method: "PATCH", json: { status, reason } }),
  micSetup: () => api<MicSetup>("/mics/setup"),
  saveMicSetup: (setup: MicSetup) => api<MicSetup>("/mics/setup", { method: "PUT", json: setup }),
  testReceiver: (ip: string) => api<{ ok: boolean; deviceId?: string; error?: string }>("/mics/test", { method: "POST", json: { ip } }),
  planMics: (plan: string) => api<PlanMics>(`/mics/plans/${plan}`),
  savePlanMics: (plan: string, assignments: MicAssignment[]) =>
    api<PlanMics>(`/mics/plans/${plan}`, { method: "PUT", json: { assignments } }),
  micStatus: () => api<ReceiverStatus[]>("/mics/status"),
  plots: () => api<StagePlot[]>("/stage/plots"),
  plot: (id: string) => api<StagePlot>(`/stage/plots/${id}`),
  createPlot: (p: Partial<StagePlot>) => api<StagePlot>("/stage/plots", { method: "POST", json: p }),
  savePlot: (p: StagePlot) => api<StagePlot>(`/stage/plots/${p.id}`, { method: "PUT", json: p }),
  deletePlot: (id: string) => api<void>(`/stage/plots/${id}`, { method: "DELETE" }),
  planPlot: (plan: string) => api<{ plotId: string | null }>(`/stage/plans/${plan}`),
  setPlanPlot: (plan: string, plotId: string | null) => api<{ plotId: string | null }>(`/stage/plans/${plan}`, { method: "PUT", json: { plotId } }),
  uploadImage: (dataUrl: string) => api<{ fileId: string }>("/stage/files", { method: "POST", json: { dataUrl } }),
  pagingConfig: () => api<PagingConfig>("/paging/config"),
  savePaging: (patch: PagingPatch) => api<PagingConfig>("/paging/config", { method: "PUT", json: patch }),
  setPin: (m: Ministry, pin: string | null) => api<PagingConfig>(`/paging/pin/${m}`, { method: "PUT", json: { pin } }),
  signOutIpads: (m: Ministry) => api<{ ok: true }>(`/paging/signout/${m}`, { method: "POST" }),
  discoverPro: (port?: number) => api<ProPresenterMachine[]>(`/paging/discover${port ? `?port=${port}` : ""}`),
  testPro: (host: string, port: number) => api<ProPresenterMachine>("/paging/connect-test", { method: "POST", json: { host, port } }),
  proThemes: () => api<ProThemeOption[]>("/paging/themes"),
  proMessages: () => api<ProMessageOption[]>("/paging/messages"),
  checkInLocations: () => api<CheckInLocation[]>("/paging/locations"),
  pagingStatus: () => api<PagingStatus>("/paging/status"),
  page: (ministry: Ministry, code: string, childName?: string | null) =>
    api<{ event: PageEvent; status: PagingStatus }>("/paging/page", { method: "POST", json: { ministry, code, childName } }),
  testPage: (m: Ministry) => api<{ event: PageEvent; status: PagingStatus }>(`/paging/test/${m}`, { method: "POST" }),
  ipads: () => api<KioskAddresses>("/paging/ipads"),
  updates: () => api<UpdateStatus>("/updates"),
  checkUpdates: () => api<UpdateStatus>("/updates/check", { method: "POST" }),
  installUpdate: () => api<UpdateStatus>("/updates/install", { method: "POST" }),
  pagingChildren: () => api<Record<Ministry, KioskChild[]>>("/paging/children"),
  removeMember: (st: string, plan: string, tm: string) =>
    api<void>(`/services/plans/${st}/${plan}/team-members/${tm}`, { method: "DELETE" }),
};

export const qk = {
  me: ["me"] as const,
  settings: ["settings"] as const,
  workflows: ["workflows"] as const,
  board: (wf: string) => ["board", wf] as const,
  contacts: (wf: string) => ["contacts", wf] as const,
  notes: (card: string) => ["notes", card] as const,
  plans: ["plans"] as const,
  serviceTypes: ["serviceTypes"] as const,
  typePlans: (st: string) => ["plans", st] as const,
  plan: (st: string, plan: string) => ["plan", st, plan] as const,
  counts: (plan: string) => ["counts", plan] as const,
  checkins: (plan: string) => ["checkins", plan] as const,
  micSetup: ["micSetup"] as const,
  micStatus: ["micStatus"] as const,
  plots: ["plots"] as const,
  plot: (id: string) => ["plot", id] as const,
  planPlot: (plan: string) => ["planPlot", plan] as const,
  planMics: (plan: string) => ["planMics", plan] as const,
  candidates: (plan: string, team: string, pos: string) => ["candidates", plan, team, pos] as const,
  conflicts: (plan: string, person: string) => ["conflicts", plan, person] as const,
  paging: ["paging"] as const,
  pagingStatus: ["pagingStatus"] as const,
  proThemes: ["proThemes"] as const,
  proMessages: ["proMessages"] as const,
  checkInLocations: ["checkInLocations"] as const,
  ipads: ["ipads"] as const,
  updates: ["updates"] as const,
  matrix: (st: string, weeks: number, past: number) => ["matrix", st, weeks, past] as const,
  runSheet: (plan: string) => ["runSheet", plan] as const,
  live: (plan: string) => ["live", plan] as const,
  pagingChildren: ["pagingChildren"] as const,
};

/** Query options shared everywhere, so the list is fetched once and reused (and prefetched). */
export const plansQuery = { queryKey: qk.plans, queryFn: () => Api.plans(), staleTime: 60_000 };
export const planQuery = (st: string, plan: string) => ({
  queryKey: qk.plan(st, plan),
  queryFn: () => Api.plan(st, plan),
  staleTime: 15_000,
});
