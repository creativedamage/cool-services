/**
 * Team check-ins: who on each team scheduled for a service has checked in.
 *
 * Two sources: Planning Center Check-Ins (read-only through its API: it can't create check-ins), and
 * staff check-ins recorded here in Cool Services (the Check in button on the staff phone page and on
 * the desktop Team check-ins page). A staff check-in covers every service that day the person is
 * scheduled on, on each of their teams.
 *
 * Also the phone pages' settings: on/off, a PIN for leads and one for staff, friendly addresses.
 */
import crypto from "node:crypto";
import type { PcoApi } from "../pco/api.js";
import { SignedOutError } from "../pco/client.js";
import type { PlanDetail, StaffCheckIn, TeamCheckIns, TeamPhoneRole, TeamPhonesConfig } from "../../../shared/types.js";
import { extras } from "./db.js";

/* ───────────── Staff check-ins ───────────── */

const KEY = "staffCheckIns";
const all = () => extras.get<StaffCheckIn[]>(KEY, []);
const localDay = (iso: string) => new Date(iso).toDateString();

/** Plans on the same day as this one that the person is scheduled on (not declined), with their teams. */
async function sameDayPlans(api: PcoApi, st: string, planId: string, personId: string) {
  const here = await api.getPlan(st, planId);
  const day = localDay(here.sortDate);
  const upcoming = await api.listUpcomingPlans().catch(() => []);
  const others = upcoming.filter((p) => p.id !== planId && localDay(p.sortDate) === day);
  const plans: PlanDetail[] = [here, ...(await Promise.all(others.map((p) => api.getPlan(p.serviceTypeId, p.id).catch(() => null)))).filter((p): p is PlanDetail => Boolean(p))];
  return plans.flatMap((p) => [...new Set(p.roster.filter((m) => m.personId === personId && m.status !== "D").map((m) => m.teamId))]
    .map((teamId) => ({ plan: p, teamId, name: p.roster.find((m) => m.personId === personId)!.name })));
}

/** Check someone in on every service that day they're on, for each of their teams. Returns how many. */
export async function staffCheckIn(api: PcoApi, st: string, planId: string, personId: string, by: string) {
  const spots = await sameDayPlans(api, st, planId, personId);
  if (!spots.length) throw Object.assign(new Error("They aren’t scheduled on this service."), { status: 404 });
  const at = new Date().toISOString();
  const list = all();
  const added: StaffCheckIn[] = [];
  for (const s of spots) {
    if (list.some((x) => x.personId === personId && x.planId === s.plan.id && x.teamId === s.teamId)) continue;
    added.push({ id: crypto.randomBytes(6).toString("hex"), personId, name: s.name, planId: s.plan.id, serviceTypeId: s.plan.serviceTypeId, teamId: s.teamId, at, by });
  }
  // Keep about two weeks.
  const cutoff = Date.now() - 14 * 864e5;
  extras.set(KEY, [...list.filter((x) => Date.parse(x.at) > cutoff), ...added]);
  bust();
  return { services: new Set(spots.map((s) => s.plan.id)).size, teams: new Set(spots.map((s) => s.teamId)).size };
}

/** Undo a staff check-in (all of that day's services). */
export async function staffUndo(api: PcoApi, st: string, planId: string, personId: string) {
  const here = await api.getPlan(st, planId);
  const day = localDay(here.sortDate);
  const upcoming = await api.listUpcomingPlans().catch(() => []);
  const ids = new Set([planId, ...upcoming.filter((p) => localDay(p.sortDate) === day).map((p) => p.id)]);
  extras.set(KEY, all().filter((x) => !(x.personId === personId && ids.has(x.planId))));
  bust();
}

/* ───────────── The combined view ───────────── */

/** Several phones asking at once share one computation (and it's kept for a few seconds). */
const memo = new Map<string, { at: number; p: Promise<TeamCheckIns> }>();
const bust = () => memo.clear();

export function teamCheckIns(api: PcoApi, st: string, planId: string, onDenied: (e: any) => string, key?: string): Promise<TeamCheckIns> {
  const k = key ? `${key}:${planId}` : null;
  const hit = k ? memo.get(k) : null;
  if (hit && Date.now() - hit.at < 8000) return hit.p;
  const p = build(api, st, planId, onDenied);
  if (k) { memo.set(k, { at: Date.now(), p }); p.catch(() => memo.delete(k)); }
  return p;
}

async function build(api: PcoApi, st: string, planId: string, onDenied: (e: any) => string): Promise<TeamCheckIns> {
  const plan = await api.getPlan(st, planId);
  let rows: { personId: string | null; at: string }[] = [];
  let checkInsError: string | null = null;
  try {
    rows = (await api.getCheckIns(st, planId)).rows;
  } catch (e: any) {
    if (e instanceof SignedOutError) throw e;
    checkInsError = e?.status === 403 || e?.status === 401 ? onDenied(e) : (e?.message ?? "Check-Ins couldn’t be read.");
  }
  const firstIn = new Map<string, string>();
  for (const r of rows) if (r.personId && (!firstIn.has(r.personId) || r.at < firstIn.get(r.personId)!)) firstIn.set(r.personId, r.at);
  const staff = all().filter((x) => x.planId === planId);
  const teams = new Map<string, TeamCheckIns["teams"][number]>();
  for (const m of plan.roster) {
    if (m.status === "D") continue;
    const t: TeamCheckIns["teams"][number] = teams.get(m.teamId) ?? { teamId: m.teamId, teamName: m.teamName, people: [] };
    const p = t.people.find((x) => x.personId === m.personId);
    if (p) { p.positions.push(m.positionName); teams.set(m.teamId, t); continue; }
    const pco = firstIn.get(m.personId);
    const byStaff = staff.find((x) => x.personId === m.personId && x.teamId === m.teamId) ?? staff.find((x) => x.personId === m.personId);
    const via = pco && (!byStaff || pco <= byStaff.at) ? "checkins" : byStaff ? "staff" : undefined;
    t.people.push({
      personId: m.personId, name: m.name, avatarUrl: m.avatarUrl, positions: [m.positionName], status: m.status,
      checkedInAt: via === "checkins" ? pco! : via === "staff" ? byStaff!.at : null,
      checkedInVia: via, checkedInBy: via === "staff" ? byStaff!.by : undefined,
    });
    teams.set(m.teamId, t);
  }
  const order = plan.teams.map((t) => t.id);
  return {
    teams: [...teams.values()].sort((a, b) => (order.indexOf(a.teamId) + 1 || 999) - (order.indexOf(b.teamId) + 1 || 999)),
    checkInsError, fetchedAt: new Date().toISOString(),
  };
}

/* ───────────── Phone pages: settings, PINs, sessions ───────────── */

interface PhonesStored {
  enabled: boolean;
  hostnames: Partial<Record<TeamPhoneRole, string>>;
  pins: Partial<Record<TeamPhoneRole, { hash: string; salt: string; version: number }>>;
  sessions: { token: string; role: TeamPhoneRole; pinVersion: number; lastSeen: string }[];
  /** Whose Planning Center access the phone pages use (whoever last saved these settings). */
  owner: { userId: string; demo: boolean } | null;
}
const PKEY = "teamPhones";
export const ROLES: TeamPhoneRole[] = ["leads", "staff"];
export const phones = (): PhonesStored => ({ enabled: false, hostnames: {}, pins: {}, sessions: [], owner: null, ...extras.get<Partial<PhonesStored>>(PKEY, {}) });
const savePhones = (s: PhonesStored) => extras.set(PKEY, s);

const listeners = new Set<() => void>();
export const onPhonesChange = (fn: () => void) => { listeners.add(fn); };

export function phonesConfig(): TeamPhonesConfig {
  const s = phones();
  return { enabled: s.enabled, hostnames: s.hostnames, hasPin: { leads: Boolean(s.pins.leads), staff: Boolean(s.pins.staff) } };
}

export function savePhonesConfig(patch: { enabled?: boolean; hostnames?: Partial<Record<TeamPhoneRole, string>> }, owner: PhonesStored["owner"]) {
  const s = phones();
  savePhones({ ...s, ...(patch.enabled != null ? { enabled: patch.enabled } : {}), hostnames: { ...s.hostnames, ...patch.hostnames }, owner });
  for (const fn of listeners) fn();
  return phonesConfig();
}

const scrypt = (pin: string, salt: string) => crypto.scryptSync(pin, salt, 32).toString("hex");

/** A new PIN (or none) signs that role's phones out. */
export function setPhonePin(role: TeamPhoneRole, pin: string | null, owner: PhonesStored["owner"]) {
  const s = phones();
  const version = (s.pins[role]?.version ?? 0) + 1;
  if (pin) { const salt = crypto.randomBytes(16).toString("hex"); s.pins[role] = { hash: scrypt(pin, salt), salt, version }; }
  else delete s.pins[role];
  s.sessions = s.sessions.filter((x) => x.role !== role);
  s.owner = owner;
  savePhones(s);
  return phonesConfig();
}

export function signOutPhones(role: TeamPhoneRole) {
  const s = phones();
  s.sessions = s.sessions.filter((x) => x.role !== role);
  savePhones(s);
}

/** Wrong PINs: 5 tries per phone, then a wait that doubles. */
const attempts = new Map<string, { fails: number; until: number; strikes: number }>();
export function phoneUnlock(role: TeamPhoneRole, pin: string, who: string): { token: string } | { error: string; waitSeconds?: number } {
  const key = `${role}:${who}`;
  const a = attempts.get(key) ?? { fails: 0, until: 0, strikes: 0 };
  if (a.until > Date.now()) return { error: "too_many_tries", waitSeconds: Math.ceil((a.until - Date.now()) / 1000) };
  const s = phones();
  const p = s.pins[role];
  if (!p) return { error: "no_pin" };
  if (!crypto.timingSafeEqual(Buffer.from(scrypt(pin, p.salt), "hex"), Buffer.from(p.hash, "hex"))) {
    a.fails++;
    if (a.fails >= 5) { a.strikes++; a.fails = 0; a.until = Date.now() + 60_000 * 2 ** (a.strikes - 1); }
    attempts.set(key, a);
    return { error: "wrong_pin" };
  }
  attempts.delete(key);
  const token = crypto.randomBytes(32).toString("base64url");
  s.sessions = [...s.sessions.filter((x) => Date.parse(x.lastSeen) > Date.now() - 120 * 864e5), { token, role, pinVersion: p.version, lastSeen: new Date().toISOString() }].slice(-500);
  savePhones(s);
  return { token };
}

/** Is this phone signed in as this role? A staff phone may also open the leads view. */
export function phoneSession(role: TeamPhoneRole, token: string | undefined): boolean {
  if (!token) return false;
  const s = phones();
  const x = s.sessions.find((k) => k.token === token);
  if (!x || s.pins[x.role]?.version !== x.pinVersion) return false;
  if (x.role !== role && !(x.role === "staff" && role === "leads")) return false;
  if (Date.now() - Date.parse(x.lastSeen) > 3600e3) { x.lastSeen = new Date().toISOString(); savePhones(s); }
  return true;
}
