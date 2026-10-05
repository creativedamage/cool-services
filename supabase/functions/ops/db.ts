/**
 * The ops database (schema "ops"), reached with the function's own database connection. Nobody
 * else can read these tables: the ops schema isn't exposed by the API and every table has RLS on.
 * Columns are snake_case in Postgres and camelCase here.
 */
import postgres from "postgres";

const env = (k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k) ?? (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[k];

export const sql = postgres(env("SUPABASE_DB_URL") ?? env("OPS_DB_URL")!, {
  transform: postgres.camel,
  prepare: false, // through Supabase's pooler
  max: 3,
  idle_timeout: 20,
  connection: { search_path: "ops" },
});
export type Sql = typeof sql;
export type Tx = postgres.TransactionSql;
export { env };

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

/** Atomic numbers per kind and year: CC-Q-2026-0001. */
export async function nextNumber(db: Sql | Tx, kind: "Q" | "PO" | "R", prefix = "CC"): Promise<string> {
  const year = new Date().getFullYear();
  const key = `${kind}:${year}`;
  const [row] = await db`insert into ops.counters (key, value) values (${key}, 1)
    on conflict (key) do update set value = ops.counters.value + 1 returning value`;
  return `${prefix}-${kind}-${year}-${String(row.value).padStart(4, "0")}`;
}

export async function getOrg(db: Sql | Tx = sql) {
  const [o] = await db`select * from ops.organization where id = 'org'`;
  if (o) return o;
  const [n] = await db`insert into ops.organization (id) values ('org') on conflict (id) do update set id = excluded.id returning *`;
  return n;
}

/** Drop undefined keys (postgres.js won't take them in insert/update helpers). */
export const defined = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export async function logActivity(a: {
  actorId?: string | null; actorLabel?: string; action: string; detail?: string | null; area: "AUTH" | "AVL" | "REQUESTS" | "ADMIN" | "SYNC";
  entityType?: string; entityId?: string; href?: string; campusId?: string | null;
}) {
  try {
    await sql`insert into ops.activity_log ${sql(defined({
      actorId: a.actorId ?? null, actorLabel: a.actorLabel ?? null, action: a.action, detail: a.detail ?? null, area: a.area,
      entityType: a.entityType ?? null, entityId: a.entityId ?? null, href: a.href ?? null, campusId: a.campusId ?? null,
    }))}`;
  } catch (e) {
    console.error("activity log failed", e);
  }
}
