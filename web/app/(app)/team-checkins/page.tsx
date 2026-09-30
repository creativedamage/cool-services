"use client";
/**
 * Team check-ins: a tile per team (Safety, Greeters…) with how many of the people scheduled for this
 * service have checked in with Planning Center Check-Ins (8/10), grouped under ministries. Tap a tile
 * to see who's in and who isn't.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarCheck, Check, Clock3, Layers, MapPin, Plus, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { TeamCheckIns, TeamGroup } from "@shared/types";
import { Api } from "@/lib/api";
import { useCampus } from "@/lib/campus";
import { usePlans } from "@/lib/plans";
import { Avatar, Modal, Skeleton, Spinner } from "@/components/ui";
import { PrefsLink } from "@/components/settings/PrefsLink";

export default function Page() { return <Suspense><TeamCheckInsPage /></Suspense>; }

type Team = TeamCheckIns["teams"][number];

function TeamCheckInsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const plans = usePlans();
  const { campus, shows } = useCampus();
  const cutoff = Date.now() - 8 * 3600e3;
  const choices = (plans.data ?? []).filter((p) => shows(p.serviceTypeId) && Date.parse(p.sortDate) > cutoff).slice(0, 20);
  const chosen = choices.find((p) => p.id === params.get("plan")) ?? choices[0];
  const data = useQuery({
    queryKey: ["teamCheckIns", chosen?.id ?? ""],
    queryFn: () => Api.teamCheckIns(chosen!.serviceTypeId, chosen!.id),
    enabled: Boolean(chosen), refetchInterval: 15_000,
  });
  const groups = useQuery({ queryKey: ["teamGroups"], queryFn: Api.teamGroups });
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const qc = useQueryClient();
  const checkIn = useMutation({
    mutationFn: (v: { id: string; undo?: boolean }) => Api.staffCheckIn(chosen!.serviceTypeId, chosen!.id, v.id, v.undo),
    onSuccess: (d, v) => { qc.setQueryData(["teamCheckIns", chosen?.id ?? ""], d); if (!v.undo) toast.success("Checked in", { description: "On every service today they’re scheduled on." }); },
    onError: (e) => toast.error("Couldn’t check them in", { description: (e as Error).message }),
  });

  const teams = data.data?.teams ?? [];
  const sections = useMemo(() => {
    const byId = new Map(teams.map((t) => [t.teamId, t]));
    const used = new Set<string>();
    const out = (groups.data ?? []).map((g) => {
      const list = g.teamIds.map((id) => byId.get(id)).filter((t): t is Team => Boolean(t));
      list.forEach((t) => used.add(t.teamId));
      return { id: g.id, name: g.name, teams: list };
    }).filter((s) => s.teams.length);
    const rest = teams.filter((t) => !used.has(t.teamId));
    if (rest.length) out.push({ id: "other", name: out.length ? "Other teams" : "Teams", teams: rest });
    return out;
  }, [teams, groups.data]);
  const count = (list: Team[]) => ({ inn: list.reduce((n, t) => n + t.people.filter((p) => p.checkedInAt).length, 0), all: list.reduce((n, t) => n + t.people.length, 0) });
  const total = count(teams);

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4 pr-28">
        <UsersRound size={18} className="text-accent" />
        <h1 className="text-lg font-semibold">Team check-ins</h1>
        <select className="input w-auto max-w-[22rem] py-1 text-sm" value={chosen?.id ?? ""} onChange={(e) => router.replace(`/team-checkins?plan=${e.target.value}`)}>
          {choices.map((p) => <option key={p.id} value={p.id}>{new Date(p.sortDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {p.serviceTypeName} · {p.title}</option>)}
        </select>
        {campus && <span className="text-xs text-ink-muted">{campus.name}</span>}
        {data.data && <span className="ml-2 rounded-full bg-hover px-3 py-1 font-mono text-sm tabular-nums"><b className="text-ok">{total.inn}</b>/{total.all} checked in</span>}
        <button className="btn-ghost ml-auto py-1 text-xs" onClick={() => setEditing(true)}><Layers size={13} /> Ministries</button>
      </header>

      <div className="space-y-8 p-6">
        {data.data && data.data.event === null && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm">
            <MapPin size={16} className="text-accent" />
            <span className="min-w-0 flex-1">Which Check-Ins event do volunteers check in to for {chosen?.serviceTypeName ?? "this service"}? Choose it and each team’s area, so only volunteer check-ins count and staff check-ins land in the right place.</span>
            <PrefsLink section="checkins" className="btn-primary py-1 text-xs">Set up</PrefsLink>
          </div>
        )}
        {data.data?.event && <p className="-mt-4 flex items-center gap-1.5 text-xs text-ink-muted"><CalendarCheck size={12} /> Counting check-ins to <b className="text-ink-soft">{data.data.event.name}</b> · <PrefsLink section="checkins" className="text-accent hover:underline">change</PrefsLink></p>}
        {data.data?.checkInsError && (
          <div className="rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">Check-Ins can’t be read right now, so nobody shows as checked in: {data.data.checkInsError}</div>
        )}
        {!chosen && !plans.isLoading && <p className="text-sm text-ink-muted">No upcoming services{campus ? ` for ${campus.name}` : ""}.</p>}
        {(data.isLoading || plans.isLoading) && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-36" />)}</div>}
        {data.data && !teams.length && (
          <div className="panel p-8 text-center text-sm text-ink-muted">Nobody is scheduled on this service yet. Pick another service above.</div>
        )}
        {sections.map((s) => {
          const c = count(s.teams);
          return (
            <section key={s.id}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-muted">{s.name}</h2>
                <span className="font-mono text-sm tabular-nums text-ink-soft">{c.inn}/{c.all}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                {s.teams.map((t) => <Tile key={t.teamId} t={t} open={open === t.teamId} onToggle={() => setOpen(open === t.teamId ? null : t.teamId)} onCheckIn={(id, undo) => checkIn.mutate({ id, undo })} busy={checkIn.isPending ? checkIn.variables?.id ?? null : null} />)}
              </div>
            </section>
          );
        })}
      </div>
      {editing && <GroupsEditor teams={teams} groups={groups.data ?? []} onClose={() => setEditing(false)} />}
    </div>
  );
}

function Tile({ t, open, onToggle, onCheckIn, busy }: { t: Team; open: boolean; onToggle: () => void; onCheckIn: (personId: string, undo?: boolean) => void; busy: string | null }) {
  const inn = t.people.filter((p) => p.checkedInAt).length;
  const all = t.people.length;
  const pct = all ? inn / all : 0;
  const tone = all && inn === all ? "ok" : inn ? "warn" : "idle";
  return (
    <div className={clsx("panel overflow-hidden transition", open && "col-span-2", tone === "ok" && "border-ok/50")}>
      <button onClick={onToggle} className="block w-full p-4 text-left">
        <div className="flex items-center gap-2">
          {tone === "ok" ? <ShieldCheck size={16} className="text-ok" /> : <UsersRound size={16} className="text-ink-muted" />}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{t.teamName}</span>
            {t.people[0]?.expectedLocation && <span className="flex items-center gap-1 truncate text-[11px] text-ink-muted"><MapPin size={10} />{t.people[0].expectedLocation}</span>}
          </span>
        </div>
        <div className={clsx("mt-2 font-mono text-5xl font-semibold tabular-nums", tone === "ok" ? "text-ok" : tone === "warn" ? "text-ink" : "text-ink-faint")}>
          {inn}<span className="text-2xl text-ink-muted">/{all}</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-hover">
          <div className={clsx("h-full rounded-full transition-all", tone === "ok" ? "bg-ok" : "bg-warn")} style={{ width: `${pct * 100}%` }} />
        </div>
      </button>
      {open && (
        <ul className="max-h-80 divide-y divide-line/60 overflow-y-auto border-t border-line">
          {[...t.people].sort((a, b) => Number(Boolean(a.checkedInAt)) - Number(Boolean(b.checkedInAt)) || a.name.localeCompare(b.name)).map((p) => (
            <li key={p.personId} className="flex items-center gap-2.5 px-4 py-2 text-sm">
              <Avatar name={p.name} src={p.avatarUrl} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                <span className="block truncate text-[11px] text-ink-muted">{p.positions.join(", ")}{p.status === "U" ? " · unconfirmed" : ""}</span>
                {p.checkedInAt && p.location && p.expectedLocation && p.location !== p.expectedLocation && (
                  <span className="block truncate text-[11px] text-warn">checked in at {p.location}</span>
                )}
              </span>
              {p.checkedInAt ? (
                <span className="flex flex-col items-end">
                  <span className="flex items-center gap-1 text-xs text-ok"><Check size={13} /> {new Date(p.checkedInAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  {p.checkedInVia === "staff" && (
                    <button className="text-[10px] text-ink-faint hover:text-bad" title={`Checked in by ${p.checkedInBy ?? "staff"}. Click to undo.`} disabled={busy === p.personId}
                      onClick={() => onCheckIn(p.personId, true)}>by {p.checkedInBy ?? "staff"} · undo</button>
                  )}
                </span>
              ) : (
                <button className="btn-outline py-0.5 text-xs" disabled={busy === p.personId} onClick={() => onCheckIn(p.personId)} title="Check in on every service today they’re scheduled on">
                  {busy === p.personId ? <Spinner size={11} /> : <Clock3 size={12} />} Check in
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Ministries: name them and choose which teams sit under each. */
function GroupsEditor({ teams, groups, onClose }: { teams: Team[]; groups: TeamGroup[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [list, setList] = useState<TeamGroup[]>(groups);
  useEffect(() => setList(groups), [groups]);
  const save = useMutation({
    mutationFn: Api.saveTeamGroups,
    onSuccess: (g) => { qc.setQueryData(["teamGroups"], g); toast.success("Ministries saved"); onClose(); },
    onError: (e) => toast.error("Couldn’t save", { description: (e as Error).message }),
  });
  const known = useQuery({ queryKey: ["knownTeams"], queryFn: Api.knownTeams });
  const all = useMemo(() => {
    const m = new Map<string, string>((known.data ?? []).map((t) => [t.id, t.name]));
    for (const t of teams) m.set(t.teamId, t.teamName);
    return [...m].map(([teamId, teamName]) => ({ teamId, teamName })).sort((a, b) => a.teamName.localeCompare(b.teamName));
  }, [known.data, teams]);
  const groupOf = (teamId: string) => list.find((g) => g.teamIds.includes(teamId))?.id ?? "";
  const move = (teamId: string, gid: string) => setList(list.map((g) => ({ ...g, teamIds: g.id === gid ? [...g.teamIds.filter((x) => x !== teamId), teamId] : g.teamIds.filter((x) => x !== teamId) })));
  return (
    <Modal open onClose={onClose} title="Ministries" width={620}>
      <div className="max-h-[65vh] space-y-5 overflow-y-auto p-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="label">Ministries</span>
            <button className="btn-ghost py-1 text-xs" onClick={() => setList([...list, { id: `g${Math.random().toString(36).slice(2, 8)}`, name: "New ministry", teamIds: [] }])}><Plus size={13} /> Add</button>
          </div>
          <div className="space-y-1.5">
            {list.map((g) => (
              <div key={g.id} className="flex items-center gap-2">
                <input className="input py-1.5 text-sm" value={g.name} onChange={(e) => setList(list.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)))} />
                <button className="btn-ghost p-1.5 hover:text-bad" title="Remove" onClick={() => setList(list.filter((x) => x.id !== g.id))}><Trash2 size={14} /></button>
              </div>
            ))}
            {!list.length && <p className="text-sm text-ink-muted">Add ministries like “First Responders” or “Guest Services”, then put teams under them.</p>}
          </div>
        </div>
        {list.length > 0 && (
          <div>
            <span className="label">Teams</span>
            <div className="mt-2 divide-y divide-line/60">
              {all.map((t) => (
                <div key={t.teamId} className="flex items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{t.teamName}</span>
                  <select className="input w-56 py-1 text-sm" value={groupOf(t.teamId)} onChange={(e) => move(t.teamId, e.target.value)}>
                    <option value="">No ministry</option>
                    {list.map((g) => <option key={g.id} value={g.id}>{g.name || "Untitled"}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(list.filter((g) => g.name.trim()))}>{save.isPending && <Spinner />} Save</button>
      </footer>
    </Modal>
  );
}
