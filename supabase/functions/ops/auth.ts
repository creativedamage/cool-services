/**
 * Who's calling: the Sundays (Supabase Auth) sign-in in the Authorization header, checked with
 * Supabase Auth; then their memberships (one ops.users row per organization) and whether they're a
 * Sundays super admin. Access is loaded fresh on every call, so a change applies straight away.
 *
 * The organization a request is for comes from the X-Org header (the app's org switcher). Super
 * admins can enter any organization: they get a hidden "Sundays support" membership there and act
 * as its System admin.
 */
import { capabilities, effectiveAccess } from "./lib/rbac.ts";
import { BLOCKED_STATUSES, effectiveModules, type ModuleKey, type OrgStatus } from "./lib/billing.ts";
import type { MyOrg, OpsSessionUser } from "./lib/types.ts";
import { ctx, env, HttpError, raw } from "./db.ts";

type AuthUser = { id: string; email: string; name: string | null };
const seen = new Map<string, { at: number } & AuthUser>();

async function authUser(token: string): Promise<AuthUser | null> {
  const hit = seen.get(token);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  let u: AuthUser | null = null;
  if (env("OPS_TEST_AUTH") === "1" && token.startsWith("test:")) {
    const [, id, email] = token.split(":");
    u = { id, email: email.toLowerCase(), name: null };
  } else {
    const r = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env("SUPABASE_ANON_KEY") ?? "" } });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.id || !j?.email) return null;
    u = { id: j.id, email: String(j.email).toLowerCase(), name: j.user_metadata?.name ?? null };
  }
  if (seen.size > 1000) seen.clear();
  seen.set(token, { at: Date.now(), ...u });
  return u;
}

export interface Account { auth: AuthUser; memberships: Record<string, any>[]; platform: boolean }

/** The signed-in person, their memberships and super-admin status. `claim` picks up invitations sent to their email. */
export async function account(req: Request, claim = false): Promise<Account> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in to Sundays.");
  const a = await authUser(token);
  if (!a) throw new HttpError(401, "Your Sundays sign-in has expired. Sign in again.");
  if (claim) {
    await raw`update ops.users set auth_id = ${a.id}, registered = true, updated_at = now() where email = ${a.email} and auth_id is null`;
    await raw`update ops.platform_admins set auth_id = ${a.id} where email = ${a.email} and auth_id is null`;
  }
  const [memberships, admins] = await Promise.all([
    raw`select u.*, o.name as org_name, o.status as org_status from ops.users u join ops.organization o on o.id = u.org_id
      where u.auth_id = ${a.id} order by o.name nulls last`,
    raw`select 1 from ops.platform_admins where auth_id = ${a.id}`,
  ]);
  return { auth: a, memberships, platform: admins.length > 0 };
}

export const memberStatus = (m: Record<string, any>): MyOrg["memberStatus"] => (m.active ? "active" : m.pending ? "pending" : "inactive");
export const myOrgs = (acc: Account): MyOrg[] =>
  acc.memberships.map((m) => ({ id: m.orgId, name: m.orgName ?? "Untitled organization", status: m.orgStatus, memberStatus: memberStatus(m), support: m.source === "PLATFORM" }));

export interface Entered { id: string; row: Record<string, any>; modules: ModuleKey[]; member: Record<string, any> }

/** Load an organization with its plan's modules. */
export async function loadOrg(id: string) {
  const [o] = await raw`select o.*, p.modules as plan_modules from ops.organization o left join ops.plans p on p.id = o.plan_id where o.id = ${id}`;
  if (!o) return null;
  const modules = effectiveModules({ fullLicense: o.fullLicense, moduleOverrides: o.moduleOverrides ?? {} }, { modules: o.planModules ?? [] });
  return { row: o, modules };
}

/**
 * Which organization this request is for: the X-Org header if they belong to it (or are a super
 * admin), otherwise their first active membership. null = they have none.
 */
export async function pickOrg(acc: Account, req: Request): Promise<Entered | null> {
  const want = req.headers.get("x-org") || null;
  let member = want ? acc.memberships.find((m) => m.orgId === want) : undefined;
  if (!member && want && acc.platform) member = await supportMembership(acc, want);
  if (!member) member = acc.memberships.find((m) => m.active && m.source !== "PLATFORM") ?? acc.memberships.find((m) => m.source !== "PLATFORM") ?? acc.memberships[0];
  if (!member) return null;
  const o = await loadOrg(member.orgId);
  if (!o) return null;
  return { id: member.orgId, row: o.row, modules: o.modules, member };
}

/** A super admin's own way into an organization (hidden from its people lists). */
async function supportMembership(acc: Account, orgId: string) {
  const [o] = await raw`select id from ops.organization where id = ${orgId}`;
  if (!o) return undefined;
  const [m] = await raw`insert into ops.users ${raw({
    orgId, authId: acc.auth.id, email: acc.auth.email, name: acc.auth.name ?? acc.auth.email.split("@")[0], active: true, pending: false, registered: true,
    role: "ADMIN", allCampuses: true, avlLevel: "MANAGER", opsAccess: true, source: "PLATFORM", approvedAt: new Date(),
  })} on conflict (org_id, email) do update set auth_id = excluded.auth_id, registered = true returning *`;
  return m;
}

/** Can this person work in the organization right now? Throws the reason if not. */
export function checkEntry(acc: Account, e: Entered) {
  if (BLOCKED_STATUSES.includes(e.row.status as OrgStatus) && !acc.platform) {
    throw new HttpError(403, `${e.row.name ?? "This organization"} is ${String(e.row.status).toLowerCase()}. Contact Sundays to restore access.`, { status: "suspended" });
  }
  if (!e.member.active && !acc.platform) {
    throw new HttpError(403, e.member.pending ? "Your account is waiting for approval." : "Your account isn't active.", { status: e.member.pending ? "pending" : "inactive" });
  }
}

export async function sessionUser(row: Record<string, any>, platform: boolean): Promise<OpsSessionUser> {
  const teams = await raw`select team_id from ops.team_members where user_id = ${row.id}`;
  const access = platform
    ? { role: "ADMIN" as const, avlLevel: "MANAGER" as const, global: true }
    : effectiveAccess({ role: row.role, avlLevel: row.avlLevel, syncedRole: row.syncedRole, syncedAvlLevel: row.syncedAvlLevel, allCampuses: row.allCampuses });
  return {
    id: row.id, email: row.email, name: row.name,
    role: access.role, avlLevel: access.avlLevel, permissions: capabilities(access.role, access.avlLevel), opsAccess: platform || row.opsAccess !== false,
    campusId: row.campusId, allCampuses: access.global, teamIds: teams.map((t) => t.teamId as string), platform,
  };
}

/** Note a sign-in, at most once an hour per membership. */
export async function touch(row: Record<string, any>) {
  if (!row.lastLoginAt || Date.now() - new Date(row.lastLoginAt).getTime() > 3600_000) {
    await raw`update ops.users set last_login_at = now() where id = ${row.id}`;
  }
}

/** The signed-in person in the current organization (set by the router for organization routes). */
export async function requireUser(_req?: Request): Promise<OpsSessionUser> {
  const u = ctx()?.user;
  if (!u) throw new HttpError(401, "Sign in to Sundays.");
  return u;
}
