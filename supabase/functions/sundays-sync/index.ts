// Sundays settings sync. The Mac sends its Planning Center sign-in (the access token Sundays already
// has); this checks it with Planning Center, then keeps that person's settings (per church and
// person), newest change wins per setting. Values are stored encrypted.
//
//   POST { op: "pull", since?: ISO }                      → { items: [{ key, value, updatedAt, device }], now }
//   POST { op: "push", device, items: [{ key, value, updatedAt }] } → { saved: [key], newer: [{ key, value, updatedAt, device }], now }
//   POST { op: "who" }                                    → { orgId, personId, name }
//
// Header: X-PCO-Token: <Planning Center OAuth access token>
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/* ── Who is this (Planning Center), cached a few minutes per token ── */
type Who = { orgId: string; personId: string; name: string };
const seen = new Map<string, { at: number; who: Who }>();
async function sha(s: string) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return btoa(String.fromCharCode(...b));
}
async function who(token: string): Promise<Who | null> {
  const k = await sha(token);
  const hit = seen.get(k);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.who;
  const r = await fetch("https://api.planningcenteronline.com/people/v2/me", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "Sundays sync" },
  });
  if (!r.ok) return null;
  const j = await r.json();
  let orgId: string | undefined = j?.meta?.parent?.type === "Organization" ? j.meta.parent.id : undefined;
  if (!orgId) {
    const o = await fetch("https://api.planningcenteronline.com/people/v2", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    orgId = o.ok ? (await o.json())?.data?.id : undefined;
  }
  const personId = j?.data?.id;
  if (!orgId || !personId) return null;
  const w = { orgId: String(orgId), personId: String(personId), name: j?.data?.attributes?.name ?? "" };
  if (seen.size > 500) seen.clear();
  seen.set(k, { at: Date.now(), who: w });
  return w;
}

/* ── Encryption (AES-GCM, key kept in public.app_secrets, service role only) ── */
let keyP: Promise<CryptoKey> | null = null;
function key() {
  return (keyP ??= (async () => {
    const { data, error } = await db.from("app_secrets").select("value").eq("name", "sync_key").single();
    if (error || !data) throw new Error("sync key missing");
    const raw = Uint8Array.from(atob(data.value), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  })().catch((e) => { keyP = null; throw e; }));
}
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
async function seal(v: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(v))));
  return `${b64(iv)}.${b64(ct)}`;
}
async function open(s: string): Promise<unknown> {
  const [iv, ct] = s.split(".").map((x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0)));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await key(), ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

const KEY_RE = /^[a-zA-Z0-9:._-]{1,80}$/;
type Row = { key: string; value_enc: string; updated_at: string; device: string | null };
const out = async (r: Row) => ({ key: r.key, value: await open(r.value_enc), updatedAt: r.updated_at, device: r.device });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = req.headers.get("x-pco-token") ?? "";
  if (!token) return json({ error: "Sign in to Planning Center in Sundays." }, 401);
  const me = await who(token).catch(() => null);
  if (!me) return json({ error: "Planning Center didn’t accept the sign-in." }, 401);
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();
  const mine = () => db.from("sync_settings").select("key,value_enc,updated_at,device").eq("org_id", me.orgId).eq("person_id", me.personId);

  if (body.op === "who") return json(me);

  if (body.op === "pull") {
    let q = mine();
    if (typeof body.since === "string" && !Number.isNaN(Date.parse(body.since))) q = q.gt("updated_at", body.since);
    const { data, error } = await q.order("updated_at");
    if (error) return json({ error: error.message }, 500);
    return json({ items: await Promise.all((data ?? []).map(out)), now });
  }

  if (body.op === "push") {
    const items = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
    const device = typeof body.device === "string" ? body.device.slice(0, 80) : null;
    const keys = items.map((i: { key: string }) => i.key).filter((k: unknown) => typeof k === "string" && KEY_RE.test(k));
    const { data: have, error } = keys.length ? await mine().in("key", keys) : { data: [] as Row[], error: null };
    if (error) return json({ error: error.message }, 500);
    const byKey = new Map((have ?? []).map((r) => [r.key, r]));
    const saved: string[] = [];
    const newer: Row[] = [];
    const rows = [];
    for (const it of items) {
      if (typeof it?.key !== "string" || !KEY_RE.test(it.key) || Number.isNaN(Date.parse(it.updatedAt))) continue;
      const size = JSON.stringify(it.value ?? null).length;
      if (size > 900_000) continue; // a logo or a big run sheet list is fine; nothing huge
      const cur = byKey.get(it.key);
      // Newest change wins. (Times from the future are capped at now.)
      const at = new Date(Math.min(Date.parse(it.updatedAt), Date.now())).toISOString();
      if (cur && Date.parse(cur.updated_at) >= Date.parse(at)) { newer.push(cur); continue; }
      rows.push({ org_id: me.orgId, person_id: me.personId, key: it.key, value_enc: await seal(it.value ?? null), updated_at: at, device });
      saved.push(it.key);
    }
    if (rows.length) {
      const { error: e2 } = await db.from("sync_settings").upsert(rows);
      if (e2) return json({ error: e2.message }, 500);
    }
    return json({ saved, newer: await Promise.all(newer.map(out)), now });
  }
  return json({ error: "Unknown op" }, 400);
});
