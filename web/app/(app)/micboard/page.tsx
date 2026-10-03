"use client";
/**
 * Mic board & stage display. Choose what the display shows (Auto: stage plot in rehearsal, mic board
 * for the service; or pick one), change the banner message, and set pictures. The preview is exactly
 * what the network display and the second display show.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Copy, ImagePlus, LayoutTemplate, MicVocal, MonitorUp, RotateCcw, Settings2, Sparkles, Timer, Tv, Wifi, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { BoardSettings, DisplayMode } from "@shared/board";
import { Api } from "@/lib/api";
import { DisplayView } from "@/components/board/DisplayView";
import { Drawer, Spinner } from "@/components/ui";

const KEY = ["stageDisplay"];
const MODES: { mode: DisplayMode; label: string; icon: typeof Tv; hint: string }[] = [
  { mode: "auto", label: "Auto", icon: Sparkles, hint: "Stage plot during rehearsal times, mic board during service times (from Planning Center)" },
  { mode: "micboard", label: "Mic board", icon: MicVocal, hint: "Always the mic board" },
  { mode: "stageplot", label: "Stage plot", icon: LayoutTemplate, hint: "Always the stage plot" },
  { mode: "clock", label: "Clock", icon: Timer, hint: "The production clock" },
];
const VIEW_NAME = { micboard: "Mic board", stageplot: "Stage plot", clock: "Clock" } as const;

/** Shrink a picture to at most 900 px on its long side (a JPEG), so boards load fast on TVs. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.86);
  } finally { URL.revokeObjectURL(url); }
}

export default function MicBoardPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: Api.stageDisplay, refetchInterval: 2000 });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const save = useMutation({
    mutationFn: Api.saveBoard,
    onSuccess: (settings) => { qc.setQueryData(KEY, (v: any) => v && { ...v, settings }); void q.refetch(); },
    onError: (e) => toast.error("Couldn’t save", { description: (e as Error).message }),
  });
  const [open, setOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  if (!q.data) return <div className="p-8">{q.error ? <p className="text-bad">{(q.error as Error).message}</p> : <Spinner />}</div>;
  const { settings: s, state } = q.data;
  const text = banner ?? s.banner.text;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3 pr-28">
        <MicVocal size={18} className="text-accent" />
        <h1 className="text-lg font-semibold">Mic board</h1>
        <div className="flex rounded-lg border border-line p-0.5">
          {MODES.map(({ mode, label, icon: Icon, hint }) => (
            <button key={mode} title={hint} onClick={() => save.mutate({ mode })}
              className={clsx("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition", s.mode === mode ? "bg-accent text-white" : "text-ink-soft hover:bg-hover")}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink-muted">
          Showing <b className="text-ink">{VIEW_NAME[state.view]}</b>{state.reason ? ` · ${state.reason}` : ""}
          {state.service ? ` · ${state.service.serviceTypeName}, ${state.service.when}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className={clsx("flex items-center gap-1 rounded-full px-2 py-0.5", s.lan && q.data.urls.length ? "bg-ok-soft text-ok" : "bg-hover text-ink-muted")} title={q.data.urls[0]}><Wifi size={12} /> {s.lan ? "Network" : "Network off"}</span>
          <span className={clsx("flex items-center gap-1 rounded-full px-2 py-0.5", s.screen.enabled ? "bg-ok-soft text-ok" : "bg-hover text-ink-muted")}><MonitorUp size={12} /> {s.screen.enabled ? "Second display" : "Screen off"}</span>
          <button className="btn-outline py-1 text-xs" onClick={() => setOpen(true)}><Settings2 size={13} /> Display settings</button>
        </div>
      </header>

      {/* Banner message: change it any time */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-2.5">
        <span className="label">Banner</span>
        <input className="input min-w-[16rem] flex-1 py-1.5 text-sm" placeholder="A message or your mission statement, across the top of the display" maxLength={400}
          value={text} onChange={(e) => setBanner(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { save.mutate({ banner: { text, enabled: true } }); setBanner(null); } }} />
        <button className="btn-primary py-1.5 text-sm" disabled={text === s.banner.text && s.banner.enabled} onClick={() => { save.mutate({ banner: { text, enabled: true } }); setBanner(null); }}>Show</button>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft"><input type="checkbox" checked={s.banner.scroll} onChange={(e) => save.mutate({ banner: { scroll: e.target.checked } })} /> Scroll</label>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft"><input type="checkbox" checked={s.banner.enabled} onChange={(e) => save.mutate({ banner: { enabled: e.target.checked } })} /> Banner on</label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {state.error && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{state.error}</p>}
        <div className="mx-auto overflow-hidden rounded-2xl border border-line shadow-lg" style={{ aspectRatio: "16 / 9", maxHeight: "calc(100vh - 230px)" }}>
          <DisplayView s={state} now={now} />
        </div>
        <p className="mt-2 text-center text-[11px] text-ink-faint">
          This is what the display shows. Mics, receivers and who’s on which mic come from the service’s Mics panel.
        </p>
        <NetworkPanel on={s.lan} urls={q.data.urls} onTurnOn={() => save.mutate({ lan: true })} />
      </div>

      {open && <SettingsDrawer s={s} data={q.data} onSave={(p) => save.mutate(p)} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** The address to open on the display computer (any browser on the church network). */
function NetworkPanel({ on, urls, onTurnOn }: { on: boolean; urls: string[]; onTurnOn: () => void }) {
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success("Copied"));
  return (
    <section className="panel mx-auto mt-5 max-w-4xl p-5">
      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold"><Tv size={16} /> Show it on another computer</h2>
          {!on ? (
            <>
              <p className="mt-1 text-sm text-ink-muted">Turn this on, then open the address it gives you in a browser on the display computer (full screen). It shows exactly the preview above and follows every change you make here.</p>
              <button className="btn-primary mt-3" onClick={onTurnOn}><Wifi size={14} /> Turn on the network display</button>
            </>
          ) : urls.length ? (
            <>
              <p className="mt-1 text-sm text-ink-muted">On the display computer, open this in Chrome, Safari or Edge and make it full screen (on a Mac: Control-Command-F; on Windows: F11):</p>
              <div className="mt-3 flex items-center gap-2">
                <span className="select-all rounded-lg bg-hover px-3 py-2 font-mono text-lg font-semibold text-accent">{urls[0]}</span>
                <button className="btn-outline py-2" onClick={() => copy(urls[0])}><Copy size={14} /> Copy</button>
              </div>
              {urls.length > 1 && <p className="mt-2 text-xs text-ink-muted">Also works: {urls.slice(1).map((u) => <span key={u} className="mr-3 select-all font-mono">{u}</span>)}</p>}
              <p className="mt-3 text-[11px] text-ink-faint">
                Both computers need to be on the same network. If the address stops working after a restart, give this Mac a fixed IP address (a DHCP reservation in your router).
                To drop the “:port” from the address, set the port to 80 in Preferences → Network Connections → Kids &amp; Nursery iPads (the same port is used for all network pages).
                The first time, macOS asks whether Cool Services may accept incoming connections: choose Allow.
              </p>
            </>
          ) : <p className="mt-1 text-sm text-ink-muted">Starting… If this doesn’t change, check Preferences → Network Connections for a port problem.</p>}
        </div>
        {on && urls[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/paging/qr?url=${encodeURIComponent(urls[0])}`} alt="" className="h-36 w-36 shrink-0 rounded-lg bg-white p-2" />
        )}
      </div>
    </section>
  );
}

function SettingsDrawer({ s, data, onSave, onClose }: {
  s: BoardSettings; data: NonNullable<Awaited<ReturnType<typeof Api.stageDisplay>>>;
  onSave: (p: Parameters<typeof Api.saveBoard>[0]) => void; onClose: () => void;
}) {
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ["serviceTypes"], queryFn: Api.serviceTypes, staleTime: 10 * 60_000 });
  const upload = useMutation({
    mutationFn: async ({ key, file }: { key: string; file: File }) => Api.boardImage(key, await shrink(file)),
    onSuccess: (settings) => { qc.setQueryData(KEY, (v: any) => v && { ...v, settings }); toast.success("Picture saved"); },
    onError: (e) => toast.error("Couldn’t save the picture", { description: (e as Error).message }),
  });
  const remove = useMutation({ mutationFn: Api.removeBoardImage, onSuccess: (settings) => qc.setQueryData(KEY, (v: any) => v && { ...v, settings }) });
  const tiles = data.state.tiles;
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success("Copied"));

  return (
    <Drawer open onClose={onClose}>
      <header className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="font-semibold">Display settings</h2>
        <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 text-sm">
        <section className="space-y-2">
          <h3 className="label">Service</h3>
          <select className="input" value={s.serviceTypeId ?? ""} onChange={(e) => onSave({ serviceTypeId: e.target.value || null })}>
            <option value="">The next service of any type</option>
            {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label className="block"><span className="text-xs text-ink-muted">In Auto, outside rehearsal and service times show</span>
            <select className="input mt-1" value={s.autoIdle} onChange={(e) => onSave({ autoIdle: e.target.value as BoardSettings["autoIdle"] })}>
              <option value="micboard">Mic board</option><option value="stageplot">Stage plot</option><option value="clock">Clock</option>
            </select>
          </label>
          <p className="text-[11px] text-ink-faint">Auto uses the service’s times in Planning Center: the stage plot from 30 minutes before a rehearsal until it ends, the mic board from an hour before each service until 15 minutes after.</p>
        </section>

        <section className="space-y-2">
          <h3 className="label">Banner</h3>
          <div className="grid grid-cols-3 gap-2">
            <label className="block"><span className="text-xs text-ink-muted">Size</span>
              <select className="input mt-1" value={s.banner.size} onChange={(e) => onSave({ banner: { size: e.target.value as "m" } })}>
                <option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option>
              </select>
            </label>
            <label className="block"><span className="text-xs text-ink-muted">Background</span>
              <input type="color" className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-line bg-transparent" value={s.banner.background} onChange={(e) => onSave({ banner: { background: e.target.value } })} />
            </label>
            <label className="block"><span className="text-xs text-ink-muted">Text</span>
              <input type="color" className="mt-1 h-9 w-full cursor-pointer rounded-lg border border-line bg-transparent" value={s.banner.color} onChange={(e) => onSave({ banner: { color: e.target.value } })} />
            </label>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.banner.showService} onChange={(e) => onSave({ banner: { showService: e.target.checked } })} /> Show the service and its time on the left</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.banner.showClock} onChange={(e) => onSave({ banner: { showClock: e.target.checked } })} /> Show the time on the right</label>
        </section>

        <section className="space-y-2">
          <h3 className="label">Mic board</h3>
          <label className="block"><span className="text-xs text-ink-muted">Pictures</span>
            <select className="input mt-1" value={s.images} onChange={(e) => onSave({ images: e.target.value as BoardSettings["images"] })}>
              <option value="custom-then-pco">Your pictures, else Planning Center photos</option>
              <option value="pco">Planning Center photos</option>
              <option value="custom">Only your pictures</option>
              <option value="none">No pictures</option>
            </select>
          </label>
          <label className="block"><span className="text-xs text-ink-muted">Show the picture</span>
            <div className="mt-1 flex rounded-lg border border-line p-0.5">
              {([["background", "Behind the name"], ["icon", "Round photo above the name"], ["none", "No picture"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => onSave({ imageStyle: v })}
                  className={clsx("flex-1 rounded-md px-2 py-1.5 text-xs", s.imageStyle === v ? "bg-accent text-white" : "text-ink-soft hover:bg-hover")}>{label}</button>
              ))}
            </div>
          </label>
          <div className="flex flex-wrap gap-3">
            {(["vocal", "pack", "other"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" checked={s.kinds.includes(k)} onChange={(e) => onSave({ kinds: e.target.checked ? [...s.kinds, k] : s.kinds.filter((x) => x !== k) })} />
                {k === "vocal" ? "Vocal mics" : k === "pack" ? "Packs" : "Other"}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.hideUnassigned} onChange={(e) => onSave({ hideUnassigned: e.target.checked })} /> Hide mics nobody is on</label>
          <label className="flex items-center gap-2"><span className="text-xs text-ink-muted">Tiles per row</span>
            <select className="input w-28 py-1" value={s.columns} onChange={(e) => onSave({ columns: Number(e.target.value) })}>
              <option value={0}>Fit</option>{[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </section>

        <section className="space-y-2">
          <h3 className="label">Your pictures</h3>
          <p className="text-[11px] text-ink-faint">A picture for a person follows them to whatever mic they’re on. A picture for a mic shows when it’s unassigned or the person has none.</p>
          <ul className="divide-y divide-line/60 rounded-lg border border-line">
            {tiles.map((t) => {
              const keys = [...(t.person ? [{ key: `person:${t.person.id}`, label: t.person.name }] : []), { key: `mic:${t.channelId}`, label: `${t.micLabel} (the mic)` }];
              return keys.map(({ key, label }) => {
                const has = Boolean(s.customImages[key]);
                return (
                  <li key={key} className="flex items-center gap-3 px-3 py-2">
                    <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-hover">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {has && <img src={`/api/board-out/image/${s.customImages[key]}`} alt="" className="h-full w-full object-cover" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <label className="btn-ghost cursor-pointer p-1.5" title="Choose a picture">
                      {upload.isPending && upload.variables?.key === key ? <Spinner size={12} /> : <ImagePlus size={14} />}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate({ key, file: f }); e.target.value = ""; }} />
                    </label>
                    {has && <button className="btn-ghost p-1.5" title="Use the Planning Center photo again" onClick={() => remove.mutate(key)}><RotateCcw size={13} /></button>}
                  </li>
                );
              });
            })}
            {!tiles.length && <li className="px-3 py-3 text-ink-muted">No mics on the board yet.</li>}
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="label">Where it shows</h3>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.lan} onChange={(e) => onSave({ lan: e.target.checked })} /> On the church network (any TV or stage screen with a browser)</label>
          {s.lan && data.urls.map((u) => (
            <div key={u} className="flex items-center gap-2 pl-6 font-mono text-xs"><span className="select-all">{u}</span><button className="btn-ghost p-1" onClick={() => copy(u)}><Copy size={12} /></button></div>
          ))}
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.screen.enabled} onChange={(e) => onSave({ screen: { enabled: e.target.checked, displayId: s.screen.displayId ?? data.displays.find((d) => !d.primary)?.id ?? null } })} /> On a second display on this Mac</label>
          {data.displays.length > 0 ? (
            <select className="input ml-6 w-auto py-1" value={s.screen.displayId ?? ""} onChange={(e) => onSave({ screen: { displayId: Number(e.target.value) } })}>
              {data.displays.map((d) => <option key={d.id} value={d.id}>{d.label}{d.primary ? " (main display)" : ""}</option>)}
            </select>
          ) : <p className="pl-6 text-[11px] text-ink-faint">Displays are listed in the Cool Services Mac app.</p>}
        </section>
      </div>
    </Drawer>
  );
}
