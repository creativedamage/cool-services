"use client";
/**
 * Church Ops in Sundays (Full Mode only). People sign in with their own Church Ops account
 * (Supabase Auth: register, then a manager approves them); every screen talks to the "ops" Edge
 * Function, which checks their access level each time.
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { OpsMe } from "@shared/ops/types";
import { Api } from "@/lib/api";

export interface CloudConfig { supabaseUrl: string; publishableKey: string; opsUrl: string; testToken: string | null }

let cfgP: Promise<CloudConfig> | null = null;
const cloud = () => (cfgP ??= Api.cloud().catch((e) => { cfgP = null; throw e; }));

let client: SupabaseClient | null = null;
export async function supabase(): Promise<SupabaseClient> {
  if (client) return client;
  const c = await cloud();
  client = createClient(c.supabaseUrl, c.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "sundays-ops-auth", detectSessionInUrl: false },
  });
  return client;
}

/** Signed in to Church Ops? (undefined while checking) */
export function useOpsSession(): { session: Session | null | undefined; test: boolean } {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [test, setTest] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    (async () => {
      const c = await cloud();
      if (c.testToken) { if (alive) { setTest(true); setSession({ access_token: c.testToken } as Session); } return; }
      const sb = await supabase();
      const { data } = await sb.auth.getSession();
      if (alive) setSession(data.session);
      const sub = sb.auth.onAuthStateChange((_e, s) => setSession(s));
      off = () => sub.data.subscription.unsubscribe();
    })().catch(() => alive && setSession(null));
    return () => { alive = false; off?.(); };
  }, []);
  return { session, test };
}

export class OpsError extends Error {
  constructor(message: string, public status: number, public body: Record<string, unknown> = {}) { super(message); }
}

async function token(): Promise<string | null> {
  const c = await cloud();
  if (c.testToken) return c.testToken;
  const { data } = await (await supabase()).auth.getSession();
  return data.session?.access_token ?? null;
}

/** Call the ops function: ops("/requests/mine"), ops("/requests", { method: "POST", json: {...} }). */
export async function ops<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const c = await cloud();
  const t = await token();
  if (!t) throw new OpsError("Sign in to Church Ops.", 401);
  const res = await fetch(`${c.opsUrl}${path}`, {
    method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${t}`, apikey: c.publishableKey, ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new OpsError(String(body.error ?? `Church Ops error (${res.status})`), res.status, body);
  return body as T;
}

export const opsKey = (...k: unknown[]) => ["ops", ...k] as const;

/** A Church Ops query (cached under ["ops", …]; cleared on sign-out). */
export function useOps<T>(path: string | null, opts: Omit<UseQueryOptions<T>, "queryKey" | "queryFn"> = {}) {
  return useQuery<T>({
    queryKey: opsKey(path),
    queryFn: () => ops<T>(path!),
    enabled: Boolean(path) && (opts.enabled ?? true),
    retry: (n, e) => !(e instanceof OpsError && e.status < 500) && n < 2,
    ...opts,
  });
}

export const useOpsMe = (enabled = true) => useOps<OpsMe>("/me", { enabled, staleTime: 30_000, refetchInterval: 60_000 });

/** After a change: refetch every Church Ops screen. */
export function useOpsRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["ops"] });
}

export async function opsSignOut() {
  const c = await cloud();
  if (!c.testToken) await (await supabase()).auth.signOut();
}

/* ── Formatting ── */
export const fmtMoney = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const money0 = (c: number) => (c < 0 ? "-" : "") + "$" + Math.round(Math.abs(c) / 100).toLocaleString("en-US");
export const fmtPct = (bps: number) => `${(bps / 100).toFixed(1)}%`;
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
export const fmtDateTime = (d: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export function fmtAge(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60_000);
  if (m < 60) return `${Math.max(m, 0)}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
