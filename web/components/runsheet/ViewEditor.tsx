"use client";
/** Create or change an operator view: which Planning Center note categories show, in what order. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { RunSheetView } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { Modal, Spinner } from "@/components/ui";

export function ViewEditor({ view, categories, planNoteCategories, colorOf, onClose, onSaved }: {
  view: RunSheetView | null; // null = new view
  categories: string[];
  planNoteCategories: string[];
  colorOf: (c: string) => string;
  onClose: () => void;
  onSaved: (v: RunSheetView | null) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(view?.name ?? "");
  // Everything known, with this view's picks first in their order.
  const [order, setOrder] = useState<string[]>(() => [...(view?.categories ?? []), ...categories.filter((c) => !view?.categories.includes(c))]);
  const [on, setOn] = useState<Set<string>>(new Set(view?.categories ?? []));
  const [highlight, setHighlight] = useState<string | null>(view?.highlight ?? null);
  const [planNotes, setPlanNotes] = useState<Set<string> | null>(view?.planNotes ? new Set(view.planNotes) : null);
  const [desc, setDesc] = useState(view?.showDescriptions ?? true);

  const save = useMutation({
    mutationFn: () => Api.saveRunSheetView({
      id: view?.id, name: name.trim() || "My view",
      categories: order.filter((c) => on.has(c)), highlight: highlight && on.has(highlight) ? highlight : null,
      planNotes: planNotes ? [...planNotes] : null, showDescriptions: desc,
    }),
    onSuccess: (v) => { void qc.invalidateQueries({ queryKey: qk.runSheetViews }); toast.success(`View “${v.name}” saved`); onSaved(v); },
    onError: (e) => toast.error("Couldn’t save the view", { description: (e as Error).message }),
  });
  const del = useMutation({
    mutationFn: () => Api.deleteRunSheetView(view!.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.runSheetViews }); onSaved(null); },
  });

  const move = (i: number, d: -1 | 1) => setOrder((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const toggle = (c: string) => setOn((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  return (
    <Modal open onClose={onClose} width={620} title={view ? `Edit view · ${view.name}` : "New run sheet view"}>
      <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
        <label className="block"><span className="label">Name</span>
          <input className="input mt-1" autoFocus placeholder="Lighting, Video, Stage manager…" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div>
          <span className="label">Notes to show (Planning Center note categories)</span>
          <p className="mt-0.5 text-[11px] text-ink-faint">Turn on the notes this operator needs. They show as columns in this order.</p>
          <ul className="mt-2 divide-y divide-line/60 rounded-lg border border-line">
            {order.map((c, i) => (
              <li key={c} className="flex items-center gap-3 px-3 py-1.5">
                <input type="checkbox" checked={on.has(c)} onChange={() => toggle(c)} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(c) }} />
                <span className={clsx("flex-1 text-sm", !on.has(c) && "text-ink-faint")}>{c}</span>
                <label className={clsx("flex items-center gap-1 text-[11px]", on.has(c) ? "text-ink-muted" : "invisible")}>
                  <input type="radio" name="hl" checked={highlight === c} onChange={() => setHighlight(c)} /> Highlight
                </label>
                <button className="btn-ghost p-1" disabled={i === 0} onClick={() => move(i, -1)} title="Move up"><ArrowUp size={12} /></button>
                <button className="btn-ghost p-1" disabled={i === order.length - 1} onClick={() => move(i, 1)} title="Move down"><ArrowDown size={12} /></button>
              </li>
            ))}
            {!order.length && <li className="px-3 py-2 text-xs text-ink-muted">No note categories found in Planning Center yet.</li>}
          </ul>
          {highlight && <button className="mt-1 text-[11px] text-accent hover:underline" onClick={() => setHighlight(null)}>No highlight</button>}
        </div>

        {planNoteCategories.length > 0 && (
          <div>
            <span className="label">Plan notes at the top</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button onClick={() => setPlanNotes(null)} className={clsx("rounded-full border px-2.5 py-0.5 text-xs", !planNotes ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-ink-muted")}>All</button>
              {planNoteCategories.map((c) => {
                const sel = planNotes?.has(c) ?? false;
                return (
                  <button key={c} onClick={() => setPlanNotes((s) => { const n = new Set(s ?? []); if (n.has(c)) n.delete(c); else n.add(c); return n; })}
                    className={clsx("rounded-full border px-2.5 py-0.5 text-xs", sel ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-ink-muted")}>{c}</button>
                );
              })}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={desc} onChange={(e) => setDesc(e.target.checked)} /> Show item descriptions
        </label>
      </div>
      <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
        {view && <button className="btn-ghost text-bad" onClick={() => { if (confirm(`Delete the view “${view.name}”?`)) del.mutate(); }}><Trash2 size={14} /> Delete view</button>}
        <button className="btn-ghost ml-auto" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={save.isPending || !on.size} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Save view</button>
      </footer>
    </Modal>
  );
}
