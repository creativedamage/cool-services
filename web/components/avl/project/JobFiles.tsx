"use client";
/** A job's files: drawings, rack elevations, signal flow, photos, closeout documents. Drop files anywhere on the list. */
import clsx from "clsx";
import { Download, Eye, File as FileIcon, FileText, FolderOpen, Image as ImageIcon, Pencil, Share2, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { JobPage } from "@shared/ops/jobs";
import { isImage, type JobFile } from "@shared/ops/projects";
import { fmtDate, ops, useOps } from "@/lib/ops";
import { Card, Empty, ErrorBox, Loading } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";
import { useOpsUser } from "@/components/ops/context";
import { fmtSize, uploadToJob } from "./bits";
import { PhotoViewer } from "./JobLogs";

const FOLDERS = ["Drawings", "Photos", "Closeout", "Other"];
const LOG_PHOTOS = "From daily logs";

export function JobFiles({ page, church }: { page: JobPage; church: boolean }) {
  const d = useOps<JobFile[]>(`/jobs/${page.job.id}/files`);
  const [folder, setFolder] = useState<string>("All");
  const [drop, setDrop] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<{ photos: JobFile[]; i: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const me = page.crewView;
  const { user } = useOpsUser();
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const files = d.data;
  const folderOf = (f: JobFile) => (f.dailyLogId ? LOG_PHOTOS : f.folder ?? (isImage(f) ? "Photos" : "Other"));
  const folders = [...new Set([...FOLDERS, ...files.map(folderOf)])].filter((x) => x !== LOG_PHOTOS || files.some((f) => f.dailyLogId));
  const shown = folder === "All" ? files : files.filter((f) => folderOf(f) === folder);
  const target = folder === "All" || folder === LOG_PHOTOS ? null : folder;

  const upload = async (list: File[]) => {
    if (!list.length) return;
    try {
      for (const [i, f] of list.entries()) { setBusy(`Uploading ${i + 1} of ${list.length}: ${f.name}`); await uploadToJob(page.job.id, f, { folder: target ?? (f.type.startsWith("image/") ? "Photos" : null) }); }
      toast.success(`${list.length} file${list.length === 1 ? "" : "s"} added`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); void d.refetch(); }
  };
  const act = async (f: JobFile, json: Record<string, unknown> | null) => {
    try {
      if (json) await ops(`/files/${f.id}`, { method: "PUT", json }); else await ops(`/files/${f.id}`, { method: "DELETE" });
      void d.refetch();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav className="flex gap-1 overflow-x-auto lg:flex-col">
        {["All", ...folders].map((x) => {
          const n = x === "All" ? files.length : files.filter((f) => folderOf(f) === x).length;
          return (
            <button key={x} onClick={() => setFolder(x)} className={clsx("flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm", folder === x ? "bg-accent-soft font-medium text-accent" : "text-ink-soft hover:bg-hover")}>
              <FolderOpen size={14} /><span className="flex-1 truncate">{x}</span><span className="text-[11px] tabular-nums text-ink-faint">{n || ""}</span>
            </button>
          );
        })}
      </nav>
      <div onDragOver={(e) => { e.preventDefault(); setDrop(true); }} onDragLeave={() => setDrop(false)}
        onDrop={(e) => { e.preventDefault(); setDrop(false); void upload([...e.dataTransfer.files]); }}>
        <Card title={folder === "All" ? "All files" : folder} action={
          <button className="btn-primary py-1.5 text-xs" disabled={!!busy} onClick={() => input.current?.click()}>{busy ? <Spinner /> : <Upload size={13} />} Upload{target ? ` to ${target}` : ""}</button>
        }>
          <input ref={input} type="file" multiple hidden onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
          {busy && <p className="border-b border-line bg-accent-soft px-4 py-2 text-xs text-accent">{busy}</p>}
          <div className={clsx("transition", drop && "bg-accent-soft/60 ring-2 ring-inset ring-accent")}>
            {shown.length ? (
              <ul className="divide-y divide-line">
                {shown.map((f) => {
                  const img = isImage(f);
                  // Crew can change only what they added.
                  const canChange = !me || f.uploadedBy?.id === user.id;
                  return (
                    <li key={f.id} className="group/file flex items-center gap-3 px-4 py-2.5">
                      <button className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-hover text-ink-faint"
                        onClick={() => { if (img) { const ph = shown.filter(isImage); setView({ photos: ph, i: ph.indexOf(f) }); } else if (f.url) window.open(f.url, "_blank"); }}>
                        {img && f.url ? <img src={f.url} alt="" className="h-full w-full object-cover" loading="lazy" /> : /pdf/.test(f.mime ?? "") ? <FileText size={18} /> : img ? <ImageIcon size={18} /> : <FileIcon size={18} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{f.name}</div>
                        <div className="truncate text-[11px] text-ink-faint">{[fmtSize(f.sizeBytes), folder === "All" ? folderOf(f) : null, f.uploadedBy?.name, fmtDate(f.createdAt)].filter(Boolean).join(" · ")}{f.shared && !church ? " · shared with the client" : ""}</div>
                      </div>
                      <span className="flex shrink-0 items-center opacity-70 transition group-hover/file:opacity-100">
                        {f.url && !img && <a className="p-1.5 text-ink-faint hover:text-ink" href={f.url} target="_blank" rel="noreferrer" title="Open"><Eye size={14} /></a>}
                        {f.downloadUrl && <a className="p-1.5 text-ink-faint hover:text-ink" href={f.downloadUrl} title="Download"><Download size={14} /></a>}
                        {canChange && !f.dailyLogId && <button className="p-1.5 text-ink-faint hover:text-ink" title="Rename or move" onClick={() => {
                          const name = window.prompt("File name", f.name); if (name === null) return;
                          const to = window.prompt(`Folder (${FOLDERS.join(", ")}, or a new one)`, f.folder ?? folderOf(f)); if (to === null) return;
                          void act(f, { name: name.trim() || f.name, folder: to.trim() || null });
                        }}><Pencil size={14} /></button>}
                        {!me && !church && <button className={clsx("p-1.5 hover:text-ink", f.shared ? "text-accent" : "text-ink-faint")} title={f.shared ? "Shared with the client: stop sharing" : "Share with the client (client portal)"} onClick={() => void act(f, { shared: !f.shared })}><Share2 size={14} /></button>}
                        {canChange && <button className="p-1.5 text-bad/70 hover:text-bad" title="Delete" onClick={() => { if (window.confirm(`Delete “${f.name}”?`)) void act(f, null); }}><Trash2 size={14} /></button>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : <Empty>{folder === LOG_PHOTOS ? "No photos on daily logs yet." : "No files here yet. Drop drawings, rack elevations, signal flow PDFs or photos here, or use Upload."}</Empty>}
          </div>
        </Card>
        <p className="mt-2 text-[11px] text-ink-faint">Up to 100 MB a file. Big photos are shrunk before they upload.{!church && " Sharing marks a file for the client portal, which comes with billing."}</p>
      </div>
      {view && <PhotoViewer photos={view.photos} start={Math.max(0, view.i)} onClose={() => setView(null)} />}
    </div>
  );
}
