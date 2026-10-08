"use client";
/** Small pieces shared by the job's project tabs: people chips and pickers, uploads. */
import clsx from "clsx";
import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { JobFile } from "@shared/ops/projects";
import { ops } from "@/lib/ops";

export interface P { id: string; name: string }

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const HUES = [210, 262, 172, 32, 345, 140, 195, 290];
const hue = (id: string) => HUES[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % HUES.length];

export function Initials({ p, size = 22 }: { p: P; size?: number }) {
  return (
    <span title={p.name} className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-surface"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue(p.id)} 55% 48%)` }}>{initials(p.name)}</span>
  );
}
export function Faces({ people, max = 4 }: { people: P[]; max?: number }) {
  if (!people.length) return <span className="text-xs text-ink-faint">Nobody</span>;
  return (
    <span className="flex items-center -space-x-1.5">
      {people.slice(0, max).map((p) => <Initials key={p.id} p={p} />)}
      {people.length > max && <span className="pl-2.5 text-[11px] text-ink-muted">+{people.length - max}</span>}
    </span>
  );
}

/** Pick several people (a dropdown of checkboxes). */
export function PeoplePicker({ all, value, onChange, disabled, label = "People" }: { all: P[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const chosen = all.filter((p) => value.includes(p.id));
  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)} className="input flex min-h-[34px] items-center gap-2 py-1 text-left disabled:opacity-70">
        {chosen.length ? <Faces people={chosen} max={5} /> : <span className="text-ink-faint">{label}</span>}
        {!disabled && <ChevronDown size={13} className="ml-auto shrink-0 text-ink-faint" />}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-60 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lift">
          {all.map((p) => {
            const on = value.includes(p.id);
            return (
              <button type="button" key={p.id} onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
                className={clsx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover", on && "font-medium")}>
                <Initials p={p} size={20} /><span className="flex-1 truncate">{p.name}</span>{on && <Check size={14} className="text-accent" />}
              </button>
            );
          })}
          {!all.length && <p className="px-2 py-3 text-xs text-ink-faint">Nobody has AVL access yet.</p>}
          {value.length > 0 && <button type="button" className="mt-1 flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-xs text-ink-muted hover:bg-hover" onClick={() => onChange([])}><X size={12} /> Clear</button>}
        </div>
      )}
    </div>
  );
}

/* ───────────── Uploads ───────────── */

/** Big phone photos are shrunk to 2400px (JPEG) before they go up. Other files go as they are. */
async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 900_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.type === "image/jpeg") return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
    return out && out.size < file.size ? out : file;
  } catch { return file; }
}

/** Upload one file to a job: ask for a link, send the file straight to storage, then confirm. */
export async function uploadToJob(jobId: string, file: File, extra: { folder?: string | null; dailyLogId?: string | null } = {}): Promise<JobFile> {
  const blob = await shrink(file);
  const name = blob !== file && blob.type === "image/jpeg" ? file.name.replace(/\.\w+$/, "") + ".jpg" : file.name;
  const mime = blob.type || file.type || "application/octet-stream";
  const start = await ops<{ id: string; uploadUrl: string }>(`/jobs/${jobId}/files`, { json: { name, mime, sizeBytes: blob.size, ...extra } });
  const put = await fetch(start.uploadUrl, { method: "PUT", headers: { "Content-Type": mime, "x-upsert": "false" }, body: blob });
  if (!put.ok) throw new Error(`“${file.name}” didn't upload (${put.status}). Try again.`);
  return ops<JobFile>(`/files/${start.id}/done`, { method: "POST" });
}

export const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
