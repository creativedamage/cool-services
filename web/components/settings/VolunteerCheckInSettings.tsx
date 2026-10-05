"use client";
/**
 * Preferences → Team Check-ins: for each service type, the Planning Center Check-Ins event that
 * volunteers check in to, and each team's location in it (its area of serving: Greeters → Main
 * Lobby). Staff check-ins are recorded as volunteers at that location, and only check-ins to that
 * event count on Team check-ins. Shows your campus's service types; changes are kept until Save, and
 * saving only touches the service types you changed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarCheck, MapPin, Save, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { VolunteerCheckInConfig, VolunteerCheckInSetup } from "@shared/types";
import { Api } from "@/lib/api";
import { useCampus } from "@/lib/campus";
import { Spinner } from "@/components/ui";

const KEY = ["volunteerSetup"];
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/s$/, ""));

/** Best-guess location for a team: shared words in the team and location (or its folder) names. */
function guess(team: string, locs: VolunteerCheckInSetup["events"][number]["locations"]) {
  const tw = new Set(words(team));
  let best: { id: string; name: string } | null = null;
  let score = 0;
  for (const l of locs) {
    const n = words(l.name).filter((w) => tw.has(w)).length * 2 + words(l.folder ?? "").filter((w) => tw.has(w)).length;
    if (n > score) { score = n; best = { id: l.id, name: l.name }; }
  }
  return best;
}

type Draft = VolunteerCheckInConfig;
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

export function VolunteerCheckInSettings() {
  const qc = useQueryClient();
  const { campus, loaded } = useCampus();
  const [everyCampus, setEveryCampus] = useState(false);
  // Only your campus's service types are loaded and shown (Preferences → Campuses picks it).
  const scope = campus && !everyCampus ? campus.serviceTypeIds : undefined;
  const q = useQuery({
    queryKey: [...KEY, scope?.join(",") ?? "all"], queryFn: () => Api.volunteerSetup(scope),
    enabled: loaded, refetchOnWindowFocus: false, staleTime: Infinity,
  });
  // Changes stay here until Save; nothing reloads underneath you while you're choosing.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  useEffect(() => { if (q.data && !touched.size) setDraft(q.data.config); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => {
      const d = draft!;
      const sts = (q.data?.serviceTypes ?? []).filter((st) => touched.has(st.id));
      return Api.saveVolunteerConfig(sts.map((st) => ({
        id: st.id, event: d.events[st.id] ?? null,
        teams: st.teams.map((t) => ({ id: t.id, location: d.teamLocations[t.id] ?? null })),
      })));
    },
    onSuccess: (config) => {
      setTouched(new Set()); setDraft(config);
      qc.setQueriesData<VolunteerCheckInSetup>({ queryKey: KEY }, (x) => x && { ...x, config });
      void qc.invalidateQueries({ queryKey: ["teamCheckIns"] });
      toast.success("Team Check-ins saved");
    },
    onError: (e) => toast.error("Couldn’t save", { description: (e as Error).message }),
  });

  if (!loaded || q.isLoading || (q.data && !draft)) return <Spinner />;
  if (q.error || !q.data || !draft) return <p className="text-sm text-bad">Couldn’t load: {(q.error as Error)?.message}</p>;
  const { serviceTypes, events, eventsError } = q.data;
  const dirty = touched.size > 0 && !same(draft, q.data.config);
  const edit = (stId: string, d: Draft) => { setDraft(d); setTouched((t) => new Set(t).add(stId)); };

  return (
    <>
      <section className="panel p-5 text-sm text-ink-soft">
        <p>
          Choose the Planning Center Check-Ins <b>event</b> your volunteers check in to for each service type, then give each team its <b>location</b> in
          that event (its area of serving), and press <b>Save</b>. Then:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink-muted">
          <li>Team check-ins only counts check-ins to that event, so someone checking their kids in doesn’t count as serving.</li>
          <li>Staff <b>Check in</b> (desktop and staff phones) records them as a <b>Volunteer</b> at their team’s location, on every service that day they’re on.</li>
          <li>Tiles show each team’s area, and flag anyone who checked in somewhere else.</li>
        </ul>
        <p className="mt-2 text-[12px] text-ink-faint">
          Planning Center doesn’t let other apps create check-ins, so staff check-ins are kept by Sundays (they show on the service’s Check-ins tab and on
          Team check-ins, marked “by staff”) but not in Planning Center’s Check-Ins reports.
        </p>
        {eventsError && <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-warn">{eventsError}</p>}
        {campus && (
          <p className="mt-3 text-[12px] text-ink-muted">
            {everyCampus ? "Showing every campus." : <>Showing <b>{campus.name}</b> only. Other campuses are left as they are.</>}{" "}
            <button className="text-accent hover:underline" disabled={dirty} title={dirty ? "Save or discard your changes first" : undefined}
              onClick={() => { setEveryCampus(!everyCampus); setTouched(new Set()); setDraft(null); }}>
              {everyCampus ? `Only ${campus.name}` : "Show all campuses"}
            </button>
          </p>
        )}
      </section>
      {serviceTypes.map((st) => <ServiceTypeCard key={st.id} st={st} events={events} config={draft} onChange={(d) => edit(st.id, d)} />)}
      {!serviceTypes.length && <p className="text-sm text-ink-muted">No service types{campus && !everyCampus ? ` for ${campus.name}` : ""}.</p>}

      <div className={clsx("sticky bottom-0 -mx-8 flex items-center gap-3 border-t px-8 py-3 backdrop-blur transition",
        dirty ? "border-accent/40 bg-surface/95" : "border-line bg-canvas/80")}>
        <span className="text-sm text-ink-muted">{dirty ? "You have unsaved changes." : "All changes saved."}</span>
        <button className="btn-ghost ml-auto" disabled={!dirty || save.isPending} onClick={() => { setTouched(new Set()); setDraft(q.data!.config); }}>Discard</button>
        <button className="btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Spinner /> : <Save size={14} />} Save</button>
      </div>
    </>
  );
}
function ServiceTypeCard({ st, events, config, onChange }: {
  st: VolunteerCheckInSetup["serviceTypes"][number]; events: VolunteerCheckInSetup["events"]; config: VolunteerCheckInConfig; onChange: (c: VolunteerCheckInConfig) => void;
}) {
  const ev = config.events[st.id] ?? null;
  const event = events.find((e) => e.id === ev?.id);
  const [open, setOpen] = useState(!ev);
  const assigned = st.teams.filter((t) => config.teamLocations[t.id]).length;
  const folders = [...new Set((event?.locations ?? []).map((l) => l.folder ?? ""))];
  const setEvent = (id: string) => {
    const e = events.find((x) => x.id === id);
    const events2 = { ...config.events };
    if (e) events2[st.id] = { id: e.id, name: e.name }; else delete events2[st.id];
    // Locations belong to the event: drop this service type's team locations that aren't in the new one.
    const keep = new Set(e?.locations.map((l) => l.id) ?? []);
    const tl = { ...config.teamLocations };
    for (const t of st.teams) if (tl[t.id] && !keep.has(tl[t.id].id)) delete tl[t.id];
    onChange({ events: events2, teamLocations: tl });
    setOpen(true);
  };
  const setLoc = (teamId: string, locId: string) => {
    const l = event?.locations.find((x) => x.id === locId);
    const tl = { ...config.teamLocations };
    if (l) tl[teamId] = { id: l.id, name: l.name }; else delete tl[teamId];
    onChange({ ...config, teamLocations: tl });
  };
  const autoFill = () => {
    if (!event) return;
    const tl = { ...config.teamLocations };
    let n = 0;
    for (const t of st.teams) {
      if (tl[t.id]) continue;
      const g = guess(t.name, event.locations);
      if (g) { tl[t.id] = g; n++; }
    }
    onChange({ ...config, teamLocations: tl });
    toast(n ? `Matched ${n} team${n === 1 ? "" : "s"} by name` : "No more teams matched by name", { description: n ? "Check them over." : "Pick the rest by hand." });
  };

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1 font-semibold">{st.name}</h2>
        <label className="flex items-center gap-2 text-sm">
          <CalendarCheck size={14} className="text-ink-muted" />
          <select className={clsx("input w-64 py-1.5 text-sm", !ev && "border-warn/60")} value={ev?.id ?? ""} onChange={(e) => setEvent(e.target.value)}>
            <option value="">Choose the volunteer event…</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
      </div>
      {ev && !event && <p className="mt-2 text-xs text-warn">“{ev.name}” isn’t in Check-Ins any more (archived?). Choose another event.</p>}
      {event && (
        <>
          <button className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink" onClick={() => setOpen(!open)}>
            <MapPin size={12} /> {assigned} of {st.teams.length} teams have a location {open ? "· hide" : "· show"}
          </button>
          {open && (
            <div className="mt-3">
              <div className="mb-2 flex justify-end">
                <button className="btn-ghost py-1 text-xs" onClick={autoFill}><Wand2 size={13} /> Match by name</button>
              </div>
              <ul className="divide-y divide-line/60 rounded-lg border border-line">
                {st.teams.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                    <select className={clsx("input w-60 py-1 text-sm", !config.teamLocations[t.id] && "text-ink-muted")} value={config.teamLocations[t.id]?.id ?? ""} onChange={(e) => setLoc(t.id, e.target.value)}>
                      <option value="">No location (event only)</option>
                      {folders.map((f) => {
                        const opts = event.locations.filter((l) => (l.folder ?? "") === f).map((l) => <option key={l.id} value={l.id}>{l.name}</option>);
                        return f ? <optgroup key={f} label={f}>{opts}</optgroup> : opts;
                      })}
                    </select>
                  </li>
                ))}
                {!st.teams.length && <li className="px-3 py-3 text-sm text-ink-muted">No teams on this service type.</li>}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
