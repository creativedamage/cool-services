"use client";
/**
 * Preferences → Micboard. Micboard (creativedamage/micboard) runs inside Cool Services; this is where
 * it's turned on, which port it uses on the network, whether it gets names and photos from Planning
 * Center, and your own backgrounds (Micboard shows <name>.jpg or .mp4 behind that name).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Copy, ExternalLink, Film, FolderOpen, ImagePlus, Loader2, RotateCw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Api, type MicboardBackground } from "@/lib/api";

const KEY = ["micboard"];
const BG_KEY = ["micboardBackgrounds"];

/** A picture as a JPEG, at most 1600 px on its long side (Micboard only shows .jpg pictures). */
async function toJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn’t a picture")); i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88);
  } finally { URL.revokeObjectURL(url); }
}

const RUN_LABEL = { running: "Running", starting: "Starting…", off: "Off", error: "Not running", missing: "Not included in this build", companion: "Off on an FOH companion" } as const;

export function MicboardSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: Api.micboard, refetchInterval: 3000 });
  const bgs = useQuery({ queryKey: BG_KEY, queryFn: Api.micboardBackgrounds, refetchInterval: 15000 });
  const save = useMutation({
    mutationFn: Api.saveMicboard,
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error("Couldn’t save", { description: (e as Error).message }),
  });
  const [port, setPort] = useState<string | null>(null);
  if (!q.data) return <div className="panel p-5"><Loader2 className="animate-spin text-ink-muted" size={18} /></div>;
  const { settings: s, status: st, urls } = q.data;
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success("Copied"));
  const local = `http://${typeof location !== "undefined" ? location.hostname : "127.0.0.1"}:${s.port}`;

  return (
    <>
      <section className="panel space-y-4 p-5" id="micboard">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">Micboard</h2>
          <span className={clsx("rounded-full px-2 py-0.5 text-xs", st.run === "running" ? "bg-ok-soft text-ok" : st.run === "error" ? "bg-bad-soft text-bad" : "bg-hover text-ink-muted")}>
            {RUN_LABEL[st.run]}{st.run === "running" && st.version ? ` · version ${st.version}` : ""}
          </span>
          <div className="ml-auto flex gap-2">
            {st.run === "running" && <a className="btn-outline py-1 text-xs" href={local} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open Micboard</a>}
            {s.enabled && st.run !== "companion" && st.run !== "missing" && (
              <button className="btn-outline py-1 text-xs" onClick={() => void Api.restartMicboard().then(() => qc.invalidateQueries({ queryKey: KEY }))}><RotateCw size={13} /> Restart</button>
            )}
          </div>
        </div>
        <p className="text-sm text-ink-muted">
          Micboard (creativedamage/micboard) runs inside Cool Services: its own page, receivers, groups and extended names, on the network at the address below.
          The Mic board’s display shows it too. Set up receivers and groups in Micboard itself (press <b>s</b> there for its settings, <b>?</b> for its shortcuts).
        </p>
        {st.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{st.error}</p>}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.enabled} onChange={(e) => save.mutate({ enabled: e.target.checked })} /> Run Micboard</label>
          <label className="flex items-center gap-2"><span className="text-ink-muted">Port</span>
            <input className="input w-24 py-1 font-mono" inputMode="numeric" value={port ?? String(s.port)} onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
              onBlur={() => { if (port && Number(port) !== s.port) save.mutate({ port: Number(port) }); setPort(null); }} />
          </label>
          {q.data.canOpenFolder && <button className="btn-ghost py-1 text-xs" onClick={() => void Api.openMicboardFolder("config")}><FolderOpen size={13} /> Micboard’s folder</button>}
        </div>

        {st.run === "running" && urls.length > 0 && (
          <div className="flex flex-wrap items-center gap-5 rounded-xl border border-line p-4">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-ink-muted">Anywhere on the church network (phones, tablets, TVs, other computers):</div>
              <div className="mt-2 flex items-center gap-2">
                <span className="select-all rounded-lg bg-hover px-3 py-1.5 font-mono text-base font-semibold text-accent">{urls[0]}</span>
                <button className="btn-outline py-1.5" onClick={() => copy(urls[0])}><Copy size={13} /> Copy</button>
              </div>
              {urls.length > 1 && <p className="mt-2 text-xs text-ink-muted">Also: {urls.slice(1).map((u) => <span key={u} className="mr-3 select-all font-mono">{u}</span>)}</p>}
              <p className="mt-2 text-[11px] text-ink-faint">The first time, macOS may ask whether Python (Micboard) can accept incoming connections: choose Allow. A fixed IP for this Mac keeps the address the same.</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/micboard/qr?url=${encodeURIComponent(urls[0])}`} alt="" className="h-28 w-28 shrink-0 rounded-lg bg-white p-1.5" />
          </div>
        )}
      </section>

      <section className="panel space-y-3 p-5">
        <h2 className="font-semibold">Names and photos from Planning Center</h2>
        <p className="text-sm text-ink-muted">
          Who’s on each mic in the service’s Mics panel goes to Micboard as the name on that mic (Micboard’s extended names), for the service the Mic board follows.
          Micboard’s slots show up in Mic setup by themselves, so you can put people on them. Names you type in Micboard on mics nobody’s on are left alone.
        </p>
        <label className="flex items-center gap-2 text-sm"><span className="text-ink-muted">Names</span>
          <select className="input w-56 py-1" value={s.names} onChange={(e) => save.mutate({ names: e.target.value as "first" })}>
            <option value="first">First names (full where two share one)</option>
            <option value="full">Full names</option>
            <option value="off">Don’t send names</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.pcoPhotos} onChange={(e) => save.mutate({ pcoPhotos: e.target.checked })} />
          Use Planning Center photos as backgrounds (when you haven’t added your own for that name)</label>
        {q.data.sync.at && (
          <p className="text-[11px] text-ink-faint">
            {q.data.sync.error ? `Last update failed: ${q.data.sync.error}` : `Updated ${new Date(q.data.sync.at).toLocaleTimeString()}: ${q.data.sync.names} name${q.data.sync.names === 1 ? "" : "s"}, ${q.data.sync.photos} Planning Center photo${q.data.sync.photos === 1 ? "" : "s"}.`}
          </p>
        )}
      </section>

      <Backgrounds list={bgs.data ?? []} onBoard={q.data.onBoard} canOpen={q.data.canOpenFolder} />

      {st.log.length > 0 && (
        <details className="panel p-4 text-xs">
          <summary className="cursor-pointer text-ink-muted">Micboard’s log</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-soft">{st.log.join("\n")}</pre>
        </details>
      )}
    </>
  );
}

/** Your backgrounds: a picture or video for a name. Micboard shows it behind that name in TV view. */
function Backgrounds({ list, onBoard, canOpen }: { list: MicboardBackground[]; onBoard: string[]; canOpen: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const refresh = (l?: MicboardBackground[]) => { if (l) qc.setQueryData(BG_KEY, l); else void qc.invalidateQueries({ queryKey: BG_KEY }); };
  const upload = useMutation({
    mutationFn: async ({ who, file }: { who: string; file: File }) =>
      file.type === "video/mp4" || /\.mp4$/i.test(file.name) ? Api.addMicboardVideo(who, file) : Api.addMicboardBackground(who, await toJpeg(file)),
    onSuccess: (r) => { refresh(r.list); setName(""); toast.success("Background saved", { description: `Micboard shows ${r.file} behind that name.` }); },
    onError: (e) => toast.error("Couldn’t save the background", { description: (e as Error).message }),
  });
  const remove = useMutation({ mutationFn: Api.removeMicboardBackground, onSuccess: (l) => refresh(l) });
  const has = new Set(list.map((b) => b.name));
  const pick = (who: string) => { setTarget(who); fileRef.current?.click(); };

  return (
    <section className="panel space-y-3 p-5">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">Backgrounds</h2>
        {canOpen && <button className="btn-ghost ml-auto py-1 text-xs" onClick={() => void Api.openMicboardFolder("backgrounds")}><FolderOpen size={13} /> Open the folder</button>}
      </div>
      <p className="text-sm text-ink-muted">
        Micboard shows a picture (or a video, in Safari) behind each name in TV view, matched by the name on the mic: <span className="font-mono">Mollie</span> → <span className="font-mono">mollie.jpg</span>.
        Yours always win over Planning Center photos. Pictures are saved as JPEGs.
      </p>
      <input ref={fileRef} type="file" accept="image/*,video/mp4" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        const who = (target ?? name).trim();
        if (f && who) upload.mutate({ who, file: f });
      }} />

      {onBoard.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs text-ink-muted">Names on Micboard now</div>
          <div className="flex flex-wrap gap-1.5">
            {onBoard.map((n) => (
              <button key={n} onClick={() => pick(n)} title={has.has(n.toLowerCase()) ? "Replace the background" : "Add a background"}
                className={clsx("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", has.has(n.toLowerCase()) ? "border-ok/40 bg-ok-soft text-ok" : "border-line text-ink-soft hover:border-accent")}>
                <ImagePlus size={12} /> {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) pick(name.trim()); }}>
        <input className="input flex-1" placeholder="A name (as it shows on Micboard)" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setTarget(null); }} />
        <button className="btn-primary" disabled={!name.trim() || upload.isPending}>{upload.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Choose a picture or video</button>
      </form>

      {list.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {list.map((b) => (
            <div key={b.file} className="group relative overflow-hidden rounded-xl border border-line bg-black">
              {b.kind === "image"
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={`/api/micboard/backgrounds/file/${encodeURIComponent(b.file)}?t=${encodeURIComponent(b.at)}`} alt="" className="aspect-[3/4] w-full object-cover" />
                : <div className="grid aspect-[3/4] w-full place-items-center text-white/60"><Film size={28} /></div>}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2 pt-6 text-white">
                <div className="truncate text-sm font-medium">{b.name}</div>
                <div className="text-[10px] text-white/70">{b.source === "yours" ? "Yours" : b.source === "pco" ? "Planning Center" : "In the folder"} · {b.file}</div>
              </div>
              <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100">
                <button className="rounded-md bg-black/70 p-1.5 text-white" title="Replace" onClick={() => pick(b.name)}><Upload size={13} /></button>
                <button className="rounded-md bg-black/70 p-1.5 text-white hover:text-rose-300" title="Remove" onClick={() => remove.mutate(b.file)}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-ink-faint">No backgrounds yet.</p>}
    </section>
  );
}
