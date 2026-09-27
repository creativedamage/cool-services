"use client";
/** Preferences → Campuses: add/remove campuses, put each service type in one, and pick your default. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Campus } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { serviceTypesQuery } from "@/lib/plans";
import { Spinner } from "@/components/ui";

const uid = () => `c${Math.random().toString(36).slice(2, 9)}`;

export function CampusSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.campuses, queryFn: Api.campuses });
  const types = useQuery(serviceTypesQuery);
  const [list, setList] = useState<Campus[] | null>(null);
  useEffect(() => { if (q.data && !list) setList(q.data.campuses); }, [q.data, list]);
  const save = useMutation({
    mutationFn: Api.saveCampuses,
    onSuccess: (d) => { qc.setQueryData(qk.campuses, d); setList(d.campuses); },
    onError: (e) => toast.error("Couldn’t save", { description: (e as Error).message }),
  });
  const setDefault = useMutation({
    mutationFn: Api.setDefaultCampus,
    onSuccess: (d) => qc.setQueryData(qk.campuses, d),
  });
  if (!q.data || !list) return <section className="panel p-5"><Spinner /></section>;
  const commit = (next: Campus[]) => { setList(next); save.mutate(next); };
  const campusOf = (typeId: string) => list.find((c) => c.serviceTypeIds.includes(typeId))?.id ?? "";
  const moveType = (typeId: string, campusId: string) =>
    commit(list.map((c) => ({ ...c, serviceTypeIds: c.id === campusId ? [...c.serviceTypeIds.filter((x) => x !== typeId), typeId] : c.serviceTypeIds.filter((x) => x !== typeId) })));

  return (
    <>
      <section id="campuses" className="panel scroll-mt-6 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold"><Building2 size={16} /> Campuses</h2>
            <p className="mt-0.5 text-sm text-ink-muted">Group your service types by campus. The switcher at the top of the sidebar shows one campus at a time.</p>
          </div>
          <button className="btn-outline shrink-0 py-1 text-xs" onClick={() => commit([...list, { id: uid(), name: `Campus ${list.length + 1}`, serviceTypeIds: [] }])}><Plus size={13} /> Add campus</button>
        </div>
        {!list.length ? <p className="mt-4 text-sm text-ink-muted">No campuses yet. Add one to start sorting service types.</p> : (
          <ul className="mt-4 space-y-2">
            {list.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg border border-line p-2">
                <NameBox value={c.name} onSave={(name) => commit(list.map((x) => (x.id === c.id ? { ...x, name } : x)))} />
                <span className="text-xs text-ink-muted">{c.serviceTypeIds.length} service type{c.serviceTypeIds.length === 1 ? "" : "s"}</span>
                <button className={q.data.myDefault === c.id ? "btn-ghost py-1 text-xs text-accent" : "btn-ghost py-1 text-xs"} onClick={() => setDefault.mutate(q.data.myDefault === c.id ? null : c.id)}
                  title={q.data.myDefault === c.id ? "Your default campus (click to clear)" : "Make this my default campus"}>
                  <Star size={13} className={q.data.myDefault === c.id ? "fill-current" : ""} /> {q.data.myDefault === c.id ? "My default" : "Make default"}
                </button>
                <button className="btn-ghost p-1.5 hover:text-bad" title="Remove campus" onClick={() => { if (confirm(`Remove ${c.name}? Its service types stay in Planning Center; they just won’t be grouped.`)) commit(list.filter((x) => x.id !== c.id)); }}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {list.length > 0 && (
        <section className="panel p-5">
          <h2 className="font-semibold">Service types</h2>
          <p className="mt-0.5 text-sm text-ink-muted">Choose the campus each service type belongs to.</p>
          <div className="mt-3 divide-y divide-line/60">
            {(types.data ?? []).map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                <select className="input w-56 py-1 text-sm" value={campusOf(t.id)} onChange={(e) => moveType(t.id, e.target.value)}>
                  <option value="">No campus</option>
                  {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {list.length > 0 && (
        <section className="panel p-5">
          <h2 className="font-semibold">My default campus</h2>
          <p className="mt-0.5 text-sm text-ink-muted">What you see each time you open Cool Services. You can still switch campus from the sidebar any time.</p>
          <select className="input mt-3 w-72" value={q.data.myDefault ?? ""} onChange={(e) => setDefault.mutate(e.target.value || null)}>
            <option value="">All campuses</option>
            {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </section>
      )}
    </>
  );
}

function NameBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { const t = v.trim(); if (t && t !== value) onSave(t); else setV(value); };
  return <input className="input min-w-0 flex-1 py-1 text-sm font-medium" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}
