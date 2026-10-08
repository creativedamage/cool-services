"use client";
/** Daily logs: what happened on site each day (notes, issues, crew and hours) with photos, written from a phone. */
import clsx from "clsx";
import { AlertTriangle, Camera, Clock3, ImagePlus, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { JobPage } from "@shared/ops/jobs";
import { parseDay, toDay, type DailyLog, type JobFile } from "@shared/ops/projects";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Empty, ErrorBox, Field, Loading } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";
import { uploadToJob } from "./bits";

export function JobLogs({ page }: { page: JobPage }) {
  const d = useOps<DailyLog[]>(`/jobs/${page.job.id}/logs`);
  const [edit, setEdit] = useState<DailyLog | "new" | null>(null);
  const [view, setView] = useState<{ photos: JobFile[]; i: number } | null>(null);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const hours = d.data.reduce((s, l) => s + (l.hoursOnSite ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{d.data.length ? `${d.data.length} day${d.data.length === 1 ? "" : "s"} logged${hours ? ` · ${hours.toLocaleString()} hours on site` : ""}` : "What happened on site, day by day."}</p>
        <button className="btn-primary" onClick={() => setEdit("new")}><Plus size={14} /> Today&apos;s log</button>
      </div>
      {d.data.length ? d.data.map((l) => (
        <Card key={l.id}>
          <div className="flex items-start gap-4 p-4">
            <div className="w-14 shrink-0 rounded-lg border border-line text-center">
              <div className="rounded-t-lg bg-accent py-0.5 text-[10px] font-bold uppercase text-on-accent">{parseDay(l.logDate).toLocaleDateString("en-US", { month: "short" })}</div>
              <div className="py-1 text-xl font-semibold tabular-nums leading-none">{parseDay(l.logDate).getDate()}</div>
              <div className="pb-1 text-[10px] text-ink-faint">{parseDay(l.logDate).toLocaleDateString("en-US", { weekday: "short" })}</div>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                <span className="font-medium text-ink">{l.author?.name ?? "Someone"}</span>
                {l.crewCount != null && <span className="flex items-center gap-1"><Users size={12} /> {l.crewCount} on site</span>}
                {l.hoursOnSite != null && <span className="flex items-center gap-1"><Clock3 size={12} /> {l.hoursOnSite} h</span>}
                {l.canEdit && (
                  <span className="ml-auto flex gap-1">
                    <button className="p-1 text-ink-faint hover:text-ink" onClick={() => setEdit(l)} aria-label="Edit log"><Pencil size={13} /></button>
                    <DeleteLog log={l} onDone={() => void d.refetch()} />
                  </span>
                )}
              </div>
              {l.notes && <p className="whitespace-pre-wrap text-sm">{l.notes}</p>}
              {l.issues && <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span className="whitespace-pre-wrap">{l.issues}</span></p>}
              {(l.photos.length > 0 || l.canEdit) && (
                <div className="flex flex-wrap gap-2">
                  {l.photos.map((p, i) => (
                    <button key={p.id} className="h-20 w-20 overflow-hidden rounded-lg border border-line bg-hover" onClick={() => setView({ photos: l.photos, i })}>
                      {p.url && <img src={p.url} alt={p.name} className="h-full w-full object-cover" loading="lazy" />}
                    </button>
                  ))}
                  {l.canEdit && <AddPhotos jobId={page.job.id} logId={l.id} onDone={() => void d.refetch()} />}
                </div>
              )}
            </div>
          </div>
        </Card>
      )) : <Card><Empty>No daily logs yet. At the end of a day on site, note what got done, anything in the way, and add a few photos.</Empty></Card>}
      {edit && <LogModal jobId={page.job.id} log={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void d.refetch(); }} />}
      {view && <PhotoViewer photos={view.photos} start={view.i} onClose={() => setView(null)} />}
    </div>
  );
}

function DeleteLog({ log, onDone }: { log: DailyLog; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className="p-1 text-bad/70 hover:text-bad" disabled={busy} aria-label="Delete log" onClick={async () => {
      if (!window.confirm(`Delete the log for ${parseDay(log.logDate).toLocaleDateString()}${log.photos.length ? ` and its ${log.photos.length} photo${log.photos.length === 1 ? "" : "s"}` : ""}?`)) return;
      setBusy(true);
      try { await ops(`/logs/${log.id}`, { method: "DELETE" }); onDone(); } catch (e) { toast.error((e as Error).message); setBusy(false); }
    }}>{busy ? <Spinner size={12} /> : <Trash2 size={13} />}</button>
  );
}

function AddPhotos({ jobId, logId, onDone }: { jobId: string; logId: string; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [n, setN] = useState<string | null>(null);
  const go = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    try {
      for (const [i, f] of list.entries()) { setN(`${i + 1}/${list.length}`); await uploadToJob(jobId, f, { dailyLogId: logId }); }
      toast.success(`${list.length} photo${list.length === 1 ? "" : "s"} added`);
    } catch (e) { toast.error((e as Error).message); } finally { setN(null); onDone(); }
  };
  return (
    <>
      <button className="grid h-20 w-20 place-items-center rounded-lg border border-dashed border-line-strong text-ink-faint hover:border-accent hover:text-accent" disabled={!!n} onClick={() => ref.current?.click()} aria-label="Add photos">
        {n ? <span className="flex flex-col items-center gap-1 text-[10px]"><Spinner />{n}</span> : <ImagePlus size={18} />}
      </button>
      <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => { void go(e.target.files); e.target.value = ""; }} />
    </>
  );
}

function LogModal({ jobId, log, onClose, onSaved }: { jobId: string; log: DailyLog | null; onClose: () => void; onSaved: () => void }) {
  const refresh = useOpsRefresh();
  const [f, setF] = useState({ logDate: log?.logDate ?? toDay(new Date()), notes: log?.notes ?? "", issues: log?.issues ?? "", crewCount: log?.crewCount?.toString() ?? "", hoursOnSite: log?.hoursOnSite?.toString() ?? "" });
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Modal open onClose={onClose} title={log ? "Edit daily log" : "Daily log"} width={600}>
      <form className="space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy("Saving…"); setError(null);
        try {
          const json = { logDate: f.logDate, notes: f.notes, issues: f.issues || null, crewCount: f.crewCount === "" ? null : Number(f.crewCount), hoursOnSite: f.hoursOnSite === "" ? null : Number(f.hoursOnSite) };
          const saved = await ops<DailyLog>(log ? `/logs/${log.id}` : `/jobs/${jobId}/logs`, { method: log ? "PUT" : "POST", json });
          for (const [i, p] of photos.entries()) { setBusy(`Photo ${i + 1} of ${photos.length}…`); await uploadToJob(jobId, p, { dailyLogId: saved.id }); }
          toast.success("Daily log saved"); void refresh(); onSaved();
        } catch (err) { setError((err as Error).message); setBusy(null); }
      }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Day"><input type="date" required className="input" value={f.logDate} onChange={(e) => set({ logDate: e.target.value })} /></Field>
          <Field label="People on site"><input type="number" min={0} className="input" value={f.crewCount} onChange={(e) => set({ crewCount: e.target.value })} /></Field>
          <Field label="Hours on site"><input type="number" min={0} max={24} step="0.25" className="input" value={f.hoursOnSite} onChange={(e) => set({ hoursOnSite: e.target.value })} /></Field>
        </div>
        <Field label="What got done"><textarea rows={5} autoFocus className="input" value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Pulled speaker lines to the balcony, mounted the projector bracket…" /></Field>
        <Field label="Issues or delays" hint="Anything in the way: access, missing gear, changes the client asked for."><textarea rows={2} className="input" value={f.issues} onChange={(e) => set({ issues: e.target.value })} /></Field>
        <div>
          <span className="label mb-1.5 block">Photos</span>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <span key={i} className="relative h-16 w-16 overflow-hidden rounded-lg border border-line">
                <img src={URL.createObjectURL(p)} alt="" className="h-full w-full object-cover" />
                <button type="button" className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} aria-label="Remove"><X size={11} /></button>
              </span>
            ))}
            <button type="button" className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-line-strong text-ink-faint hover:border-accent hover:text-accent" onClick={() => ref.current?.click()} aria-label="Add photos"><Camera size={18} /></button>
            <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => { setPhotos([...photos, ...[...(e.target.files ?? [])]]); e.target.value = ""; }} />
          </div>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          {busy && <span className="mr-auto text-xs text-ink-muted">{busy}</span>}
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!!busy}>{busy && <Spinner />}Save log</button>
        </div>
      </form>
    </Modal>
  );
}

export function PhotoViewer({ photos, start, onClose }: { photos: JobFile[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const p = photos[i];
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/90" onClick={onClose} onKeyDown={(e) => { if (e.key === "ArrowRight") setI((i + 1) % photos.length); if (e.key === "ArrowLeft") setI((i - 1 + photos.length) % photos.length); if (e.key === "Escape") onClose(); }} tabIndex={-1} ref={(el) => el?.focus()}>
      <div className="flex items-center gap-3 px-4 py-3 text-sm text-white/80">
        <span className="truncate">{p.name}</span><span className="text-white/50">{i + 1} / {photos.length}</span>
        {p.downloadUrl && <a href={p.downloadUrl} className="ml-auto rounded px-2 py-1 hover:bg-white/10" onClick={(e) => e.stopPropagation()}>Download</a>}
        <button className={clsx("rounded p-1 hover:bg-white/10", !p.downloadUrl && "ml-auto")} aria-label="Close"><X size={18} /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {p.url && <img src={p.url} alt={p.name} className="max-h-full max-w-full object-contain" onClick={(e) => { e.stopPropagation(); setI((i + 1) % photos.length); }} />}
      </div>
    </div>
  );
}
