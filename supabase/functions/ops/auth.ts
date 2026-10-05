/**
 * Who's calling: the Sundays (Supabase Auth) sign-in in the Authorization header, checked with
 * Supabase Auth, then the person's access level loaded from ops.users on every call — so a change
 * to someone's role or campus applies straight away.
 */
import { effectiveAccess, capabilities } from "./lib/rbac.ts";
import type { OpsSessionUser } from "./lib/types.ts";
import { env, HttpError, sql } from "./db.ts";

const seen = new Map<string, { at: number; id: string; email: string; name: string | null }>();

async function authUser(token: string): Promise<{ id: string; email: string; name: string | null } | null> {
  const hit = seen.get(token);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  let u: { id: string; email: string; name: string | null } | null = null;
  if (env("OPS_TEST_AUTH") === "1" && token.startsWith("test:")) {
    const [, id, email] = token.split(":");
    u = { id, email, name: null };
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

export interface Caller { auth: { id: string; email: string; name: string | null }; row: Record<string, any> | null }

/** The signed-in person (registered or not yet approved). */
export async function caller(req: Request): Promise<Caller> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in to Sundays.");
  const a = await authUser(token);
  if (!a) throw new HttpError(401, "Your Sundays sign-in has expired. Sign in again.");
  let [row] = await sql`select * from ops.users where id = ${a.id}`;
  if (!row) {
    // Registered before the trigger existed, or the trigger missed: same rules as the trigger.
    [row] = await sql`select * from ops.users where email = ${a.email}`;
    if (row) [row] = await sql`update ops.users set id = ${a.id}, registered = true where email = ${a.email} returning *`;
    else {
      const [{ any }] = await sql`select exists (select 1 from ops.users where registered) as any`;
      [row] = await sql`insert into ops.users ${sql({
        id: a.id, email: a.email, name: a.name ?? a.email.split("@")[0], registered: true,
        active: !any, pending: any, role: any ? "STAFF" : "ADMIN", allCampuses: !any, approvedAt: any ? null : new Date(),
      })} returning *`;
    }
  }
  return { auth: a, row };
}

export async function sessionUser(row: Record<string, any>): Promise<OpsSessionUser> {
  const teams = await sql`select team_id from ops.team_members where user_id = ${row.id}`;
  const access = effectiveAccess({ role: row.role, avlLevel: row.avlLevel, syncedRole: row.syncedRole, syncedAvlLevel: row.syncedAvlLevel, allCampuses: row.allCampuses });
  return {
    id: row.id, email: row.email, name: row.name,
    role: access.role, avlLevel: access.avlLevel, permissions: capabilities(access.role, access.avlLevel), opsAccess: row.opsAccess !== false,
    campusId: row.campusId, allCampuses: access.global, teamIds: teams.map((t) => t.teamId as string),
  };
}

/** An active (approved) person, or 403. */
export async function requireUser(req: Request): Promise<OpsSessionUser> {
  const c = await caller(req);
  if (!c.row.active) throw new HttpError(403, c.row.pending ? "Your account is waiting for approval." : "Your account isn't active.", { status: c.row.pending ? "pending" : "inactive" });
  // Sign-ins, at most once an hour per person.
  if (!c.row.lastLoginAt || Date.now() - new Date(c.row.lastLoginAt).getTime() > 3600_000) {
    await sql`update ops.users set last_login_at = now() where id = ${c.row.id}`;
  }
  return sessionUser(c.row);
}
