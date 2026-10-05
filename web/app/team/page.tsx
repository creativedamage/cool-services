"use client";
/**
 * Team check-ins on phones, served on the church network (the same address as the Kids & Nursery
 * iPads): /leads for volunteer team leads (see every team and who's in), /staff for staff (the same,
 * plus a Check in button). Each is locked with its own PIN, entered once per phone. A friendly
 * address like leads.yourchurch.org or staff.yourchurch.org opens the right one.
 *
 * Phones only ever get names, photos, positions and check-in times: no contact details.
 */
import clsx from "clsx";
import { Check, ChevronDown, Delete, Lock, MapPin, RefreshCw, Search, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TeamCheckInPerson, TeamCheckIns, TeamPhoneData, TeamPhoneInfo, TeamPhoneRole } from "@shared/types";

class TErr extends Error { constructor(public status: number, message: string) { super(message); } }

async function t<T>(role: TeamPhoneRole, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/team/${role}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new TErr(res.status, data?.message ?? data?.error ?? "Something went wrong");
  return data as T;
}

const LS = "coolservices.team";
const load = (k: string) => { try { return localStorage.getItem(`${LS}.${k}`); } catch { return null; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(`${LS}.${k}`, v); } catch { /* private mode */ } };
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function useRole(): TeamPhoneRole | null | undefined {
  const [r, setR] = useState<TeamPhoneRole | null | undefined>(undefined);
  useEffect(() => {
    const p = location.pathname.replace(/\/+$/, "").split("/").pop();
    const q = new URLSearchParams(location.search).get("role");
    setR(([p, q].find((x) => x === "leads" || x === "staff") as TeamPhoneRole | undefined) ?? null);
  }, []);
  return r;
}

function useSystemTheme() {
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: light)");
    const apply = () => { document.documentElement.dataset.theme = mq.matches ? "light" : "dark"; };
    apply();
    const x = setTimeout(apply, 300);
    mq.addEventListener("change", apply);
    return () => { clearTimeout(x); mq.removeEventListener("change", apply); };
  }, []);
}

export default function TeamPhonePage() {
  useSystemTheme();
  const role = useRole();
  const [info, setInfo] = useState<TeamPhoneInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = useCallback(() => {
    if (!role) return;
    t<TeamPhoneInfo>(role, "info").then((i) => { setInfo(i); setErr(null); })
      .catch((e: TErr) => setErr(e.status === 404 ? "off" : e.message));
  }, [role]);
  useEffect(refresh, [refresh]);

  if (role === undefined) return <Shell />;
  if (role === null) return <Chooser />;
  if (err === "off") return <Shell><Centered><p className="text-ink-soft">Team check-ins on phones is turned off.</p><p className="mt-1 text-sm text-ink-muted">A staff member can turn it on in Sundays → Preferences → Network Connections.</p></Centered></Shell>;
  if (err) return <Shell><Centered><p className="text-ink-soft">Can’t reach Sundays.</p><p className="mt-1 text-sm text-ink-muted">Make sure you’re on the church Wi-Fi and the Sundays Mac is on and awake.</p><button className="btn-outline mt-6" onClick={refresh}>Try again</button></Centered></Shell>;
  if (!info) return <Shell />;
  if (!info.unlocked) return <PinPad role={role} info={info} onUnlocked={refresh} />;
  return <Teams role={role} info={info} onLocked={refresh} />;
}

function Shell({ children }: { children?: React.ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-col bg-canvas text-ink" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>{children}</div>;
}
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="m-auto flex max-w-md flex-col items-center p-8 text-center">{children}</div>;
}
function Brand({ info }: { info: TeamPhoneInfo }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-ink-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {info.logo && <img src={info.logo} alt="" className="h-6 w-6 shrink-0 rounded-md object-contain" />}
      <span className="truncate">{info.church}</span>
    </div>
  );
}

function Chooser() {
  return (
    <Shell>
      <Centered>
        <UsersRound className="text-accent" size={32} />
        <h1 className="mt-3 text-2xl font-semibold">Team check-ins</h1>
        <p className="mt-1 text-sm text-ink-muted">Which are you? You’ll need its PIN.</p>
        <div className="mt-8 grid w-72 gap-3">
          <a href="/leads" className="btn-primary justify-center py-4 text-lg">Team lead</a>
          <a href="/staff" className="btn-outline justify-center py-4 text-lg">Staff</a>
        </div>
      </Centered>
    </Shell>
  );
}

/* ───────────── PIN ───────────── */

function PinPad({ role, info, onUnlocked }: { role: TeamPhoneRole; info: TeamPhoneInfo; onUnlocked: () => void }) {
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (p = pin) => {
    if (p.length < 4 || busy) return;
    setBusy(true);
    try { await t(role, "unlock", { pin: p }); onUnlocked(); }
    catch (e) { setMsg((e as Error).message); setPin(""); }
    finally { setBusy(false); }
  };
  const press = (d: string) => { setMsg(null); setPin((p) => (p.length < 8 ? p + d : p)); };
  return (
    <Shell>
      <Centered>
        <Brand info={info} />
        <h1 className="mt-6 text-3xl font-semibold">{role === "staff" ? "Staff check-in" : "Team leads"}</h1>
        <p className="mt-1 text-ink-muted">Enter the {role === "staff" ? "staff" : "team leads"} PIN</p>
        <div className="mt-6 flex h-5 gap-3">
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <span key={i} className={clsx("h-4 w-4 rounded-full border-2 transition", i < pin.length ? "border-accent bg-accent" : "border-line-strong")} />
          ))}
        </div>
        <p className="mt-3 min-h-5 text-sm text-bad">{msg}</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <Key key={d} onClick={() => press(d)}>{d}</Key>)}
          <Key onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete"><Delete size={22} /></Key>
          <Key onClick={() => press("0")}>0</Key>
          <Key onClick={() => void submit()} disabled={pin.length < 4 || busy} primary aria-label="Unlock"><Check size={24} /></Key>
        </div>
      </Centered>
    </Shell>
  );
}
function Key({ children, primary, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button {...rest} className={clsx("grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full text-2xl font-medium transition active:scale-95 disabled:opacity-30",
      primary ? "bg-accent text-white" : "bg-raised text-ink")}>
      {children}
    </button>
  );
}

/* ───────────── Teams ───────────── */

type Team = TeamCheckIns["teams"][number];
const count = (list: Team[]) => ({ inn: list.reduce((n, x) => n + x.people.filter((p) => p.checkedInAt).length, 0), all: list.reduce((n, x) => n + x.people.length, 0) });

function Teams({ role, info, onLocked }: { role: TeamPhoneRole; info: TeamPhoneInfo; onLocked: () => void }) {
  const staff = role === "staff";
  const [plan, setPlan] = useState<string | null>(null);
  const [d, setD] = useState<TeamPhoneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ministry, setMinistry] = useState<string>(() => load("ministry") ?? "all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [me, setMe] = useState<string>(() => load("name") ?? "");
  const [askName, setAskName] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (p = plan) => {
    setLoading(true);
    try {
      const r = await t<TeamPhoneData>(role, `data${p ? `?plan=${encodeURIComponent(p)}` : ""}`);
      setD(r); setError(null);
      if (!p && r.planId) setPlan(r.planId);
    } catch (e) {
      if ((e as TErr).status === 401) return onLocked();
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [plan, role, onLocked]);
  useEffect(() => { void fetchData(); }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const x = setInterval(() => { if (document.visibilityState === "visible") void fetchData(); }, 15_000);
    const v = () => { if (document.visibilityState === "visible") void fetchData(); };
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(x); document.removeEventListener("visibilitychange", v); };
  }, [fetchData]);
  useEffect(() => keep("ministry", ministry), [ministry]);
  useEffect(() => { if (staff && load("name") === null) setAskName(true); }, [staff]);

  const say = (text: string, tone: "ok" | "bad" = "ok") => {
    setFlash({ text, tone });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 3500);
  };

  const teams = d?.data?.teams ?? [];
  const sections = useMemo(() => {
    const byId = new Map(teams.map((x) => [x.teamId, x]));
    const used = new Set<string>();
    const out = (d?.groups ?? []).map((g) => {
      const list = g.teamIds.map((id) => byId.get(id)).filter((x): x is Team => Boolean(x));
      list.forEach((x) => used.add(x.teamId));
      return { id: g.id, name: g.name, teams: list };
    }).filter((s) => s.teams.length);
    const rest = teams.filter((x) => !used.has(x.teamId));
    if (rest.length) out.push({ id: "other", name: out.length ? "Other teams" : "Teams", teams: rest });
    return out;
  }, [teams, d?.groups]);
  const shown = ministry === "all" ? sections : sections.filter((s) => s.id === ministry);
  const total = count(shown.flatMap((s) => s.teams));
  const service = d?.services.find((s) => s.id === plan);

  const search = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!search) return [];
    const seen = new Map<string, { p: TeamCheckInPerson; teams: string[] }>();
    for (const s of shown) for (const x of s.teams) for (const p of x.people) {
      if (!p.name.toLowerCase().includes(search)) continue;
      const hit = seen.get(p.personId) ?? { p, teams: [] };
      hit.teams.push(x.teamName);
      seen.set(p.personId, hit);
    }
    return [...seen.values()].sort((a, b) => a.p.name.localeCompare(b.p.name));
  }, [search, shown]);

  /** Mark someone in (or out) everywhere they appear, right away; the server answer follows. */
  const patch = (personId: string, at: string | null) => setD((cur) => cur && cur.data ? {
    ...cur, data: { ...cur.data, teams: cur.data.teams.map((x) => ({ ...x, people: x.people.map((p) => p.personId === personId ? { ...p, checkedInAt: at, checkedInVia: at ? "staff" : undefined, checkedInBy: at ? (me ? `${me} (staff phone)` : "Staff phone") : undefined } : p) })) },
  } : cur);

  const checkIn = async (p: TeamCheckInPerson, undo = false) => {
    if (!service || busy.has(p.personId)) return;
    setBusy((b) => new Set(b).add(p.personId));
    const before = p.checkedInAt;
    patch(p.personId, undo ? null : new Date().toISOString());
    try {
      const r = await t<{ ok: true; services?: number; teams?: number }>(role, "checkin", { st: service.serviceTypeId, plan: service.id, personId: p.personId, undo, by: me || undefined });
      say(undo ? `${p.name} checked out` : `${p.name} checked in${r.services && r.services > 1 ? ` to ${r.services} services` : ""}${r.teams && r.teams > 1 ? ` (${r.teams} teams)` : ""}`);
      void fetchData();
    } catch (e) {
      patch(p.personId, before);
      say((e as Error).message, "bad");
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(p.personId); return n; });
    }
  };

  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <Shell>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 px-4 pb-3 pt-3 backdrop-blur" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
        <div className="flex items-center gap-2">
          <Brand info={info} />
          <span className={clsx("ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider", staff ? "bg-accent-soft text-accent" : "bg-hover text-ink-muted")}>{staff ? "Staff" : "Team leads"}</span>
          <button className="btn-ghost shrink-0 p-1.5" aria-label="Refresh" onClick={() => void fetchData()}><RefreshCw size={16} className={clsx(loading && "animate-spin")} /></button>
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <h1 className="text-xl font-semibold">Team check-ins</h1>
          {d?.data && <span className="font-mono text-lg tabular-nums"><b className="text-ok">{total.inn}</b><span className="text-ink-muted">/{total.all}</span></span>}
        </div>
        {d && d.services.length > 0 && (
          <select className="input mt-2 w-full py-2 text-[15px]" value={plan ?? ""} onChange={(e) => { setPlan(e.target.value); setD((x) => x && { ...x, data: null }); }}>
            {d.services.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
        {sections.length > 1 && (
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
            {[{ id: "all", name: "All" }, ...sections].map((s) => (
              <button key={s.id} onClick={() => setMinistry(s.id)}
                className={clsx("shrink-0 rounded-full border px-3 py-1.5 text-sm transition", ministry === s.id ? "border-accent bg-accent text-white" : "border-line text-ink-soft")}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="relative mt-2">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="input w-full py-2 pl-9 pr-9 text-[16px]" placeholder={staff ? "Find someone to check in…" : "Find someone…"} value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-faint" aria-label="Clear" onClick={() => setQ("")}><X size={16} /></button>}
        </div>
      </header>

      <main className="flex-1 space-y-6 px-4 py-4">
        {error && <p className="rounded-xl border border-bad/40 bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
        {d?.data?.checkInsError && <p className="rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">{d.data.checkInsError}</p>}
        {d && !d.services.length && <p className="py-10 text-center text-ink-muted">No upcoming services.</p>}
        {d && d.services.length > 0 && !d.data && <p className="py-10 text-center text-ink-muted">Loading…</p>}
        {d?.data && !teams.length && <p className="py-10 text-center text-ink-muted">Nobody is scheduled on this service yet.</p>}

        {search ? (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">{hits.length} match{hits.length === 1 ? "" : "es"}</h2>
            <ul className="divide-y divide-line/60 overflow-hidden rounded-2xl border border-line bg-surface">
              {hits.map(({ p, teams: tn }) => <PersonRow key={p.personId} p={p} sub={tn.join(", ")} staff={staff} busy={busy.has(p.personId)} onCheckIn={checkIn} />)}
              {!hits.length && <li className="px-4 py-6 text-center text-sm text-ink-muted">Nobody by that name on this service.</li>}
            </ul>
          </section>
        ) : shown.map((s) => {
          const c = count(s.teams);
          return (
            <section key={s.id}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">{s.name}</h2>
                <span className="font-mono text-sm tabular-nums text-ink-soft">{c.inn}/{c.all}</span>
              </div>
              <div className="space-y-2.5">
                {s.teams.map((x) => {
                  const inn = x.people.filter((p) => p.checkedInAt).length;
                  const all = x.people.length;
                  const done = all > 0 && inn === all;
                  const isOpen = open.has(x.teamId);
                  return (
                    <div key={x.teamId} className={clsx("overflow-hidden rounded-2xl border bg-surface", done ? "border-ok/50" : "border-line")}>
                      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => toggle(x.teamId)} aria-expanded={isOpen}>
                        {done ? <ShieldCheck size={20} className="shrink-0 text-ok" /> : <UsersRound size={20} className="shrink-0 text-ink-muted" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{x.teamName}</span>
                          {x.people[0]?.expectedLocation && <span className="flex items-center gap-1 truncate text-xs text-ink-muted"><MapPin size={11} />{x.people[0].expectedLocation}</span>}
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-hover">
                            <span className={clsx("block h-full rounded-full transition-all", done ? "bg-ok" : "bg-warn")} style={{ width: `${all ? (inn / all) * 100 : 0}%` }} />
                          </span>
                        </span>
                        <span className={clsx("font-mono text-3xl font-semibold tabular-nums", done ? "text-ok" : inn ? "text-ink" : "text-ink-faint")}>{inn}<span className="text-lg text-ink-muted">/{all}</span></span>
                        <ChevronDown size={18} className={clsx("shrink-0 text-ink-faint transition", isOpen && "rotate-180")} />
                      </button>
                      {isOpen && (
                        <ul className="divide-y divide-line/60 border-t border-line">
                          {[...x.people].sort((a, b) => Number(Boolean(a.checkedInAt)) - Number(Boolean(b.checkedInAt)) || a.name.localeCompare(b.name))
                            .map((p) => <PersonRow key={p.personId} p={p} sub={p.positions.join(", ")} staff={staff} busy={busy.has(p.personId)} onCheckIn={checkIn} />)}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>

      <footer className="flex items-center gap-3 border-t border-line px-4 py-3 text-xs text-ink-muted">
        {staff && (
          <button className="flex min-w-0 items-center gap-1.5 truncate" onClick={() => setAskName(true)}>
            <UserRound size={13} /> {me ? `Checking in as ${me}` : "Add your name"}
          </button>
        )}
        {d?.data && <span className="ml-auto shrink-0">Updated {time(d.data.fetchedAt)}</span>}
        <button className={clsx("flex shrink-0 items-center gap-1", !d?.data && "ml-auto")} onClick={async () => { await t(role, "lock", {}).catch(() => null); onLocked(); }}>
          <Lock size={13} /> Lock
        </button>
      </footer>

      {flash && (
        <div className="pointer-events-none fixed inset-x-4 z-30 flex justify-center" style={{ bottom: "calc(env(safe-area-inset-bottom) + 4rem)" }}>
          <div className={clsx("rounded-xl px-4 py-2.5 text-sm font-medium shadow-xl", flash.tone === "ok" ? "bg-ok text-white" : "bg-bad text-white")}>{flash.text}</div>
        </div>
      )}
      {askName && <NameSheet initial={me} onDone={(n) => { setMe(n); keep("name", n); setAskName(false); }} />}
    </Shell>
  );
}

function PersonRow({ p, sub, staff, busy, onCheckIn }: { p: TeamCheckInPerson; sub: string; staff: boolean; busy: boolean; onCheckIn: (p: TeamCheckInPerson, undo?: boolean) => void }) {
  const [confirmUndo, setConfirmUndo] = useState(false);
  useEffect(() => { if (!confirmUndo) return; const x = setTimeout(() => setConfirmUndo(false), 3000); return () => clearTimeout(x); }, [confirmUndo]);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Avatar name={p.name} src={p.avatarUrl} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{p.name}</span>
        <span className="block truncate text-xs text-ink-muted">{sub}{p.status === "U" ? " · unconfirmed" : ""}</span>
        {p.checkedInAt && p.location && p.expectedLocation && p.location !== p.expectedLocation && <span className="block truncate text-xs text-warn">checked in at {p.location}</span>}
      </span>
      {p.checkedInAt ? (
        <span className="flex shrink-0 flex-col items-end">
          <span className="flex items-center gap-1 text-sm font-medium text-ok"><Check size={15} /> {time(p.checkedInAt)}</span>
          {p.checkedInVia === "staff" && (
            staff
              ? <button className={clsx("text-[11px]", confirmUndo ? "font-semibold text-bad" : "text-ink-faint")} disabled={busy}
                  onClick={() => (confirmUndo ? (setConfirmUndo(false), onCheckIn(p, true)) : setConfirmUndo(true))}>{confirmUndo ? "Tap to undo" : "by staff · undo"}</button>
              : <span className="text-[11px] text-ink-faint">by staff</span>
          )}
        </span>
      ) : staff ? (
        <button className="btn-primary shrink-0 px-4 py-2.5 text-[15px] active:scale-95" disabled={busy} onClick={() => onCheckIn(p)}>
          {busy ? "…" : "Check in"}
        </button>
      ) : (
        <span className="shrink-0 text-sm text-ink-faint">not yet</span>
      )}
    </li>
  );
}

function Avatar({ name, src }: { name: string; src: string | null }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
  // eslint-disable-next-line @next/next/no-img-element
  return src && !broken ? <img src={src} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" onError={() => setBroken(true)} />
    : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-hover text-xs font-semibold text-ink-muted">{initials}</span>;
}

function NameSheet({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={() => onDone(initial)}>
      <div className="w-full rounded-t-3xl border-t border-line bg-surface p-5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Your name</h2>
        <p className="mt-1 text-sm text-ink-muted">Shows next to the people you check in, so the team knows who did it. Optional.</p>
        <input className="input mt-4 w-full py-2.5 text-[16px]" autoFocus placeholder="First name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onDone(name.trim()); }} />
        <div className="mt-4 flex gap-3">
          <button className="btn-ghost flex-1 justify-center py-3" onClick={() => onDone("")}>Skip</button>
          <button className="btn-primary flex-1 justify-center py-3" onClick={() => onDone(name.trim())}>Save</button>
        </div>
      </div>
    </div>
  );
}
