/** App URLs in one place (query-param routes work in the static Mac-app build). */
const q = (s: string) => encodeURIComponent(s);
export const routes = {
  board: (workflowId: string) => `/workflows/board?id=${q(workflowId)}`,
  plan: (serviceTypeId: string, planId: string) => `/services/plan?st=${q(serviceTypeId)}&plan=${q(planId)}`,
  checkins: (serviceTypeId: string, planId: string) => `/services/checkins?st=${q(serviceTypeId)}&plan=${q(planId)}`,
  planStage: (serviceTypeId: string, planId: string) => `/services/stage?st=${q(serviceTypeId)}&plan=${q(planId)}`,
  matrix: (serviceTypeId: string) => `/services/matrix?st=${q(serviceTypeId)}`,
  runSheet: (serviceTypeId: string, planId: string) => `/runsheet?st=${q(serviceTypeId)}&plan=${q(planId)}`,
  stagePlot: (plotId: string) => `/stage-plots/edit?id=${q(plotId)}`,
};
