/**
 * Access model
 * ────────────
 * Two apps on one sign-in:
 *  Operations  (church business) — `opsAccess`, then the main role STAFF < MANAGER < EXECUTIVE, plus ADMIN.
 *  AVL         (quoting other churches) — avlLevel NONE | TECH | MANAGER, independent of Operations.
 * System admins can open both.
 * Scope:      campus (home campus only) or global (`allCampuses`). Executives/Admins are always global.
 *
 *  Staff             make & track own requests
 *  Manager (campus)  + approve/handle all requests at their campus; manage users/teams/routing/campus there
 *  Manager (global)  + the same everywhere; add campuses, edit request types; can grant Admin
 *  Executive         sees everything incl. AVL; makes & approves any request; grants up to Executive + Admin
 *  Admin             everything, incl. directory sync and organization settings
 *
 * Pure module — shared by the ops Edge Function (the guards) and Sundays' screens.
 */
export type Role = "STAFF" | "MANAGER" | "EXECUTIVE" | "ADMIN";
export type AvlLevel = "NONE" | "TECH" | "MANAGER";

/** Derived capabilities (kept as flags so feature code can ask simple questions). */
export type Permission = "AVL_ACCESS" | "AVL_PURCHASING" | "QUOTE_APPROVE" | "REQUEST_APPROVE" | "MANAGE_USERS" | "ORG_ADMIN";

export const ROLE_RANK: Record<Role, number> = { STAFF: 0, MANAGER: 1, EXECUTIVE: 2, ADMIN: 3 };
export const AVL_RANK: Record<AvlLevel, number> = { NONE: 0, TECH: 1, MANAGER: 2 };

export const ROLES: { key: Role; label: string; help: string }[] = [
  { key: "STAFF", label: "Staff", help: "Make and track their own requests" },
  { key: "MANAGER", label: "Manager", help: "Approve & handle requests, manage users, teams and routing — at their campus, or everywhere if global" },
  { key: "EXECUTIVE", label: "Executive", help: "Sees every campus. Makes and approves any request" },
  { key: "ADMIN", label: "System admin", help: "Everything in Operations and AVL, plus organization settings" },
];
export const AVL_LEVELS: { key: AvlLevel; label: string; help: string }[] = [
  { key: "NONE", label: "None", help: "No AVL access" },
  { key: "TECH", label: "AVL Tech", help: "Clients, quotes, product pricing, vendors" },
  { key: "MANAGER", label: "AVL Manager", help: "AVL Tech + approving quotes, AVL people and business settings" },
];
export const roleLabel = (r: Role) => ROLES.find((x) => x.key === r)!.label;
export const avlLabel = (a: AvlLevel) => AVL_LEVELS.find((x) => x.key === a)!.label;

export const maxRole = (a: Role, b?: Role | null): Role => (b && ROLE_RANK[b] > ROLE_RANK[a] ? b : a);
export const maxAvl = (a: AvlLevel, b?: AvlLevel | null): AvlLevel => (b && AVL_RANK[b] > AVL_RANK[a] ? b : a);

/** Effective role / AVL level = the higher of the manual value and what sync grants. */
export function effectiveAccess(u: { role: Role; avlLevel: AvlLevel; syncedRole?: Role | null; syncedAvlLevel?: AvlLevel | null; allCampuses: boolean }) {
  const role = maxRole(u.role, u.syncedRole);
  const avlLevel = maxAvl(u.avlLevel, u.syncedAvlLevel);
  return { role, avlLevel, global: u.allCampuses || ROLE_RANK[role] >= ROLE_RANK.EXECUTIVE };
}

export function capabilities(role: Role, avl: AvlLevel): Permission[] {
  const r = ROLE_RANK[role];
  const caps = new Set<Permission>();
  if (AVL_RANK[avl] >= 1 || role === "ADMIN") caps.add("AVL_ACCESS");
  if (AVL_RANK[avl] >= 2 || role === "ADMIN") {
    caps.add("AVL_PURCHASING");
    caps.add("QUOTE_APPROVE");
  }
  if (r >= ROLE_RANK.MANAGER) {
    caps.add("REQUEST_APPROVE");
    caps.add("MANAGE_USERS");
  }
  if (role === "ADMIN") caps.add("ORG_ADMIN");
  return [...caps];
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  avlLevel: AvlLevel;
  permissions: Permission[];
  /** Uses Sundays | Operations (admins always do). */
  opsAccess: boolean;
  /** Sundays super admin acting in this organization. */
  platform?: boolean;
  campusId: string | null;
  /** true for global managers, executives and admins */
  allCampuses: boolean;
  teamIds: string[];
}

type U = SessionUser | null | undefined;

export const can = (u: U, p: Permission) => !!u && (u.permissions.includes(p) || u.permissions.includes("ORG_ADMIN"));
export const isAdmin = (u: U) => !!u && u.role === "ADMIN";
export const atLeast = (u: U, r: Role) => !!u && ROLE_RANK[u.role] >= ROLE_RANK[r];
export const hasAvlAccess = (u: U) => can(u, "AVL_ACCESS");
export const hasOpsAccess = (u: U) => !!u && (u.opsAccess || u.role === "ADMIN");
/** AVL Managers and admins: approve quotes, manage AVL people and AVL's business settings. */
export const isAvlManager = (u: U) => can(u, "QUOTE_APPROVE");
export const canSeeCost = hasAvlAccess;

export const seesAllCampuses = (u: U) => !!u && (u.allCampuses || atLeast(u, "EXECUTIVE"));
export const canAccessCampus = (u: U, campusId: string | null | undefined) =>
  !!u && (seesAllCampuses(u) || (!!campusId && u.campusId === campusId));

// ── Settings clearance ───────────────────────────────────────
/** Any manager+ sees the Settings section. */
export const canOpenSettings = (u: U) => atLeast(u, "MANAGER");
/** Global-only settings: add campuses, edit request-type definitions & supply lists, org-wide teams. */
export const isGlobalManager = (u: U) => atLeast(u, "MANAGER") && seesAllCampuses(u);
/** Manage a specific campus's teams/routing/details. */
export const canManageCampus = (u: U, campusId: string | null | undefined) =>
  atLeast(u, "MANAGER") && (campusId ? canAccessCampus(u, campusId) : seesAllCampuses(u));
export const canViewActivity = (u: U) => atLeast(u, "MANAGER");

/** Roles an actor may assign. Campus managers: Staff/Manager. Global managers: + Admin. Executives: + Executive. */
export function grantableRoles(u: U): Role[] {
  if (!u || !atLeast(u, "MANAGER")) return [];
  if (isAdmin(u)) return ["STAFF", "MANAGER", "EXECUTIVE", "ADMIN"];
  if (u.role === "EXECUTIVE") return ["STAFF", "MANAGER", "EXECUTIVE", "ADMIN"];
  return seesAllCampuses(u) ? ["STAFF", "MANAGER", "ADMIN"] : ["STAFF", "MANAGER"];
}

/** Can the actor create/edit a user with these (resulting) attributes? Returns an error string or null. */
export function checkUserGrant(
  actor: U,
  target: { role: Role; allCampuses: boolean; campusId: string | null },
): string | null {
  if (!actor || !atLeast(actor, "MANAGER")) return "You don't have permission to manage users.";
  if (!grantableRoles(actor).includes(target.role)) return `You can't assign the ${roleLabel(target.role)} role.`;
  if (!seesAllCampuses(actor)) {
    if (target.allCampuses) return "Only global managers and executives can give all-campus access.";
    if (!target.campusId || target.campusId !== actor.campusId) return "Campus managers can only manage users at their own campus.";
  }
  return null;
}

/** Can the actor open/edit this existing user at all? */
export function canEditUser(
  actor: U,
  target: { id: string; role: Role; allCampuses: boolean; campusId: string | null },
): boolean {
  if (!actor || !atLeast(actor, "MANAGER")) return false;
  if (actor.id === target.id) return true; // own profile (role changes still checked)
  return checkUserGrant(actor, target) === null;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
