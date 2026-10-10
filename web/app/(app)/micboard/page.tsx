"use client";
/**
 * Mic board & stage display. Choose what the display shows (Auto: the mic board around rehearsals and
 * services; or pick one), and set up the board: your logo and the clock in the middle, the
 * backgrounds library (synced to every Mac you sign in on), and each mic's color, line and picture.
 * The preview is exactly what the network display and the second display show.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Copy, Eye, EyeOff, ImagePlus, Plus, Trash2, WifiOff, MicVocal, MonitorUp, Settings2, Sparkles, Timer, Tv, Upload, Wifi, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TILE_COLORS, type BoardMic, type BoardSettings, type BoardTile, type DisplayMode } from "@shared/board";
import { Api } from "@/lib/api";
import { DisplayView } from "@/components/board/DisplayView";
import { LogosPanel } from "@/components/board/LogoSchedule";
import { Drawer, Spinner } from "@/components/ui";

const KEY = ["stageDisplay"];
const MODES: { mode: DisplayMode; label: string; icon: typeof Tv; hint: string }[] = [
  { mode: "auto", label: "Auto", icon: Sparkles, hint: "The mic board from before each rehearsal and service until it ends (from Planning Center); otherwise your idle choice" },
  { mode: "micboard", label: "Mic board", icon: MicVocal, hint: "Always the mic board" },
  { mode: "clock", label: "Clock", icon: Timer, hint: "The production clock" },
];
const VIEW_NAME = { micboard: "Mic board", clock: "Clock" } as const;

/**
 * Shrink a picture for the board: backgrounds to at most 1600 px on their long side (a JPEG), a logo
 * to 900 px (a PNG, so it stays see-through). Each one syncs to your other Macs on its own, so it's
 * kept under about 600 KB.
 */
async function shrink(file: File, kind: "background" | "logo"): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn’t a picture this browser can open.")); i.src = url; });
    const draw = (max: number) => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      return c;
    };
    const fits = (d: string) => d.length * 0.75 < 600_000;
    if (kind === "logo") {
      for (const max of [900, 700, 500]) { const d = draw(max).toDataURL("image/png"); if (fits(d)) return d; }
      return draw(500).toDataURL("image/webp", 0.9);
    }
    for (const [max, q] of [[1600, 0.84], [1600, 0.72], [1280, 0.72], [1000, 0.7]] as const) { const d = draw(max).toDataURL("image/jpeg", q); if (fits(d)) return d; }
    return draw(800).toDataURL("image/jpeg", 0.65);
  } finally { URL.revokeObjectURL(url); }
}
const fileName = (f: File) => f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
const bgUrl = (id: string) => `/api/board-out/image/${encodeURIComponent(id)}`;

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
          This is what the display shows. Who’s on each mic comes from the service’s Mics panel; logo, clock, backgrounds and each mic’s color and line are in Display settings.
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
                The first time, macOS asks whether Sundays may accept incoming connections: choose Allow.
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


type Save = (p: Parameters<typeof Api.saveBoard>[0]) => void;
type Data = NonNullable<Awaited<ReturnType<typeof Api.stageDisplay>>>;

function SettingsDrawer({ s, data, onSave, onClose }: { s: BoardSettings; data: Data; onSave: Save; onClose: () => void }) {
  const types = useQuery({ queryKey: ["serviceTypes"], queryFn: Api.serviceTypes, staleTime: 10 * 60_000 });
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success("Copied"));

  return (
    <Drawer open onClose={onClose}>
      <header className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="font-semibold">Display settings</h2>
        <button className="btn-ghost p-1.5" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto p-5 text-sm">
        <CenterSection s={s} onSave={onSave} />
        <CardsSection s={s} onSave={onSave} />
        <LibrarySection s={s} />
        <MicsSection s={s} mics={data.mics} onSave={onSave} />
        <PeopleSection s={s} tiles={data.state.tiles} />

        <section className="space-y-2">
          <h3 className="label">Service</h3>
          <div className="flex rounded-lg border border-line p-0.5">
            {([["weekend", "The weekend’s service"], ["open", "The service I have open"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => onSave({ follow: v })}
                className={clsx("flex-1 rounded-md px-2 py-1.5 text-xs", (s.follow ?? "weekend") === v ? "bg-accent text-white" : "text-ink-soft hover:bg-hover")}>{label}</button>
            ))}
          </div>
          <p className="text-[11px] text-ink-faint">
            {(s.follow ?? "weekend") === "weekend" ? "Uses the weekend picked in the sidebar. It stays on that weekend until someone picks another." : "Open a service under Services and the board switches to it."}
            {data.state.service ? <> Now: <span className="text-ink-soft">{data.state.service.serviceTypeName} · {data.state.service.when}</span></> : null}
          </p>
          <label className="block"><span className="text-xs text-ink-muted">{(s.follow ?? "weekend") === "open" ? "Until you open one, the weekend’s service of" : "The weekend’s service of"}</span>
            <select className="input mt-1" value={s.serviceTypeId ?? ""} onChange={(e) => onSave({ serviceTypeId: e.target.value || null })}>
              <option value="">Any type</option>
              {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs text-ink-muted">In Auto, outside rehearsal and service times show</span>
            <select className="input mt-1" value={s.autoIdle} onChange={(e) => onSave({ autoIdle: e.target.value as BoardSettings["autoIdle"] })}>
              <option value="micboard">Mic board</option><option value="clock">Clock</option>
            </select>
          </label>
          <p className="text-[11px] text-ink-faint">Auto uses the service’s times in Planning Center: the mic board from 30 minutes before a rehearsal until it ends, and from an hour before each service until 15 minutes after.</p>
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
          ) : <p className="pl-6 text-[11px] text-ink-faint">Displays are listed in the Sundays Mac app.</p>}
        </section>
      </div>
    </Drawer>
  );
}

/** Settings saved through these come back as the new settings; put them where the page reads them. */
function useSetSettings() {
  const qc = useQueryClient();
  return (settings: BoardSettings) => { qc.setQueryData(KEY, (v: any) => v && { ...v, settings }); void qc.invalidateQueries({ queryKey: KEY }); };
}
const failed = (what: string) => (e: unknown) => toast.error(`Couldn’t ${what}`, { description: (e as Error).message });

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg border border-line p-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={clsx("flex-1 rounded-md px-2 py-1.5 text-xs", value === v ? "bg-accent text-white" : "text-ink-soft hover:bg-hover")}>{label}</button>
      ))}
    </div>
  );
}

/** The middle of the board: your logo over the clock. */
function CenterSection({ s, onSave }: { s: BoardSettings; onSave: Save }) {
  const c = s.center;
  return (
    <section className="space-y-3">
      <h3 className="label">Middle of the board</h3>
      <LogosPanel s={s} shrink={(f) => shrink(f, "logo")} />
      <label className="block"><span className="text-xs text-ink-muted">Clock</span>
        <div className="mt-1"><Segmented value={c.clock} options={[["time", "Time of day"], ["production", "Production clock"]] as const} onChange={(v) => onSave({ center: { clock: v } })} /></div>
      </label>
      {c.clock === "time" ? (
        <div className="flex gap-4">
          <label className="flex items-center gap-2"><input type="checkbox" checked={c.seconds} onChange={(e) => onSave({ center: { seconds: e.target.checked } })} /> Seconds</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={c.date} onChange={(e) => onSave({ center: { date: e.target.checked } })} /> The date under it</label>
        </div>
      ) : (
        <p className="text-[11px] text-ink-faint">Just the production clock’s main timer (counting down, or whatever it’s set to), with the name of the timer you loaded under it. Load and start timers on the Clock page; nothing else from the clock shows here.</p>
      )}
    </section>
  );
}

function CardsSection({ s, onSave }: { s: BoardSettings; onSave: Save }) {
  return (
    <section className="space-y-3">
      <h3 className="label">Cards</h3>
      <label className="block"><span className="text-xs text-ink-muted">Names</span>
        <div className="mt-1"><Segmented value={s.names ?? "first"} options={[["first", "First names"], ["full", "Full names"]] as const} onChange={(v) => onSave({ names: v })} /></div>
      </label>
      <label className="block"><span className="text-xs text-ink-muted">Pictures</span>
        <select className="input mt-1" value={s.images} onChange={(e) => onSave({ images: e.target.value as BoardSettings["images"] })}>
          <option value="custom-then-pco">Their background, else their Planning Center photo</option>
          <option value="custom">Backgrounds only</option>
          <option value="pco">Planning Center photos only</option>
          <option value="none">No pictures</option>
        </select>
      </label>
      <label className="block"><span className="text-xs text-ink-muted">Cards across each side</span>
        <select className="input mt-1" value={s.columns} onChange={(e) => onSave({ columns: Number(e.target.value) })}>
          <option value={0}>Fit automatically</option>
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={s.stack ?? true} onChange={(e) => onSave({ stack: e.target.checked })} />
        <span>One card per person
          <span className="block text-[11px] text-ink-faint">Someone on more than one mic (a vocal and their acoustic’s pack) gets one card, labeled “VOX 1 + AG PACK”, with a battery for each.</span>
        </span>
      </label>
      <p className="text-[11px] text-ink-faint">Mics fill the left side first, then the right, in Mic setup order. Each card’s battery is read from its Shure receiver (read-only); a low battery gets a yellow edge, one to change now a flashing red one.</p>
    </section>
  );
}

/** The backgrounds library: pictures you upload once, on every Mac you sign in on. */
function LibrarySection({ s }: { s: BoardSettings }) {
  const set = useSetSettings();
  const [busy, setBusy] = useState(0);
  const add = async (list: FileList) => {
    const fs_ = [...list];
    setBusy(fs_.length);
    for (const f of fs_) {
      try { const r = await Api.addBoardBackground(fileName(f), await shrink(f, "background")); set(r.settings); }
      catch (e) { failed(`add ${f.name}`)(e); }
      setBusy((n) => n - 1);
    }
  };
  const rename = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => Api.renameBoardBackground(id, name), onSuccess: set, onError: failed("rename it") });
  const remove = useMutation({ mutationFn: Api.removeBoardBackground, onSuccess: set, onError: failed("remove it") });
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="label">Backgrounds</h3>
        <label className={clsx("btn-outline cursor-pointer py-1 text-xs", busy > 0 && "pointer-events-none opacity-60")}><ImagePlus size={13} /> {busy > 0 ? `Adding ${busy}…` : "Add pictures"}
          <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/heic" className="hidden" onChange={(e) => { if (e.target.files?.length) void add(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      <p className="text-[11px] text-ink-faint">Your backgrounds folder: upload once and every Mac you sign in on has them. A background named like a person (“Eddie”, or “Eddie Smith”) shows behind them automatically; or pick one for a mic or a person below.</p>
      {s.backgrounds.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-ink-muted">No backgrounds yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {s.backgrounds.map((b) => (
            <div key={b.id} className="group relative overflow-hidden rounded-lg border border-line bg-hover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bgUrl(b.id)} alt="" className="aspect-[4/5] w-full object-cover" />
              <button className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100" title="Remove from the library"
                onClick={() => { if (window.confirm(`Remove “${b.name}” from the backgrounds on every Mac?`)) remove.mutate(b.id); }}><Trash2 size={12} /></button>
              <input className="w-full bg-transparent px-1.5 py-1 text-[11px] outline-none focus:bg-surface" defaultValue={b.name} maxLength={80}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== b.name) rename.mutate({ id: b.id, name: v }); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** A background from the library, or automatic. */
function BgSelect({ s, value, onChange, auto = "Automatic" }: { s: BoardSettings; value: string | undefined; onChange: (id: string | null) => void; auto?: string }) {
  const known = value && s.backgrounds.some((b) => b.id === value) ? value : "";
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-7 w-6 shrink-0 overflow-hidden rounded border border-line bg-hover">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {known && <img src={bgUrl(known)} alt="" className="h-full w-full object-cover" />}
      </span>
      <select className="input min-w-0 flex-1 py-1 text-xs" value={known} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{auto}</option>
        {s.backgrounds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </div>
  );
}

/** Each mic: on the board or not, its color, your line under its name, its picture. Plus mics that aren't on the network. */
function MicsSection({ s, mics, onSave }: { s: BoardSettings; mics: BoardMic[]; onSave: Save }) {
  const qc = useQueryClient();
  const set = useSetSettings();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<BoardMic["kind"]>("pack");
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const add = useMutation({
    mutationFn: () => Api.addBoardMic(label.trim(), kind),
    onSuccess: () => { setLabel(""); void refresh(); toast.success("Mic added", { description: "Put someone on it in the service’s Mics panel." }); },
    onError: failed("add the mic"),
  });
  const del = useMutation({ mutationFn: Api.removeBoardMic, onSuccess: () => void refresh() });
  const pick = useMutation({ mutationFn: ({ key, id }: { key: string; id: string | null }) => Api.pickBoardImage(key, id), onSuccess: set, onError: failed("pick it") });
  const [text, setText] = useState<Record<string, string>>({});
  const hidden = new Set(s.hidden ?? []);
  const toggle = (id: string) => onSave({ hidden: hidden.has(id) ? [...hidden].filter((x) => x !== id) : [...hidden, id] });
  const saveText = (id: string) => {
    const v = (text[id] ?? s.tileText[id] ?? "").trim();
    if (v === (s.tileText[id] ?? "")) return;
    const next = { ...s.tileText };
    if (v) next[id] = v; else delete next[id];
    onSave({ tileText: next });
  };
  const half = Math.ceil(mics.filter((m) => !hidden.has(m.id)).length / 2);
  let shown = 0;

  return (
    <section className="space-y-2">
      <h3 className="label">Mics on the board</h3>
      <div className="divide-y divide-line rounded-lg border border-line">
        {mics.length === 0 && <p className="px-3 py-2 text-xs text-ink-muted">No mics yet. Add receivers in Settings → Mic setup, or add a mic below.</p>}
        {mics.map((m, i) => {
          const off = hidden.has(m.id);
          const side = off ? null : ++shown <= half ? "Left" : "Right";
          const color = s.tileColor[m.id] || TILE_COLORS[i % TILE_COLORS.length];
          return (
            <div key={m.id} className={clsx("space-y-1.5 px-3 py-2", off && "opacity-50")}>
              <div className="flex items-center gap-2">
                <button className="btn-ghost p-1" title={off ? "Show on the board" : "Hide from the board"} onClick={() => toggle(m.id)}>{off ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                <label className="relative h-5 w-5 shrink-0 cursor-pointer overflow-hidden rounded-full border border-line" style={{ background: color }} title="Label color">
                  <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={color} onChange={(e) => onSave({ tileColor: { ...s.tileColor, [m.id]: e.target.value } })} />
                </label>
                <span className="min-w-0 flex-1 truncate font-medium">{m.label}</span>
                {side && <span className="text-[11px] text-ink-faint">{side}</span>}
                {m.networked
                  ? <span className="flex items-center gap-1 text-[11px] text-ok" title="Battery read from its receiver"><Wifi size={11} /></span>
                  : <>
                      <span className="flex items-center gap-1 text-[11px] text-ink-muted" title="Not on the network: shows who has it, no battery"><WifiOff size={11} /></span>
                      <button className="btn-ghost p-1 text-ink-muted hover:text-bad" title="Remove this mic" onClick={() => del.mutate(m.id)}><Trash2 size={13} /></button>
                    </>}
              </div>
              {!off && (
                <div className="grid grid-cols-2 gap-2 pl-8">
                  <input className="input py-1 text-xs" placeholder="Your line under the name" maxLength={60}
                    value={text[m.id] ?? s.tileText[m.id] ?? ""} onChange={(e) => setText({ ...text, [m.id]: e.target.value })}
                    onBlur={() => saveText(m.id)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                  <BgSelect s={s} value={s.customImages[`mic:${m.id}`]} auto="Their picture" onChange={(id) => pick.mutate({ key: `mic:${m.id}`, id })} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (label.trim()) add.mutate(); }}>
        <input className="input flex-1" placeholder="Add a mic that isn’t on the network (e.g. AG 1)" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
        <select className="input w-24" value={kind} onChange={(e) => setKind(e.target.value as BoardMic["kind"])}>
          <option value="vocal">Vocal</option><option value="pack">Pack</option><option value="other">Other</option>
        </select>
        <button className="btn-primary px-3" disabled={!label.trim() || add.isPending}><Plus size={14} /></button>
      </form>
      <p className="text-[11px] text-ink-faint">A mic’s own picture is for whoever is on it. Who’s on each mic comes from the service’s Mics panel, so put Adam on “AG 1” there and it joins his card.</p>
    </section>
  );
}

/** A background for a person, wherever they are on the board. */
function PeopleSection({ s, tiles }: { s: BoardSettings; tiles: BoardTile[] }) {
  const set = useSetSettings();
  const pick = useMutation({ mutationFn: ({ key, id }: { key: string; id: string | null }) => Api.pickBoardImage(key, id), onSuccess: set, onError: failed("pick it") });
  const people = [...new Map(tiles.filter((t) => t.person).map((t) => [t.person!.id, t.person!])).values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!people.length || !s.backgrounds.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="label">People on this service</h3>
      <div className="divide-y divide-line rounded-lg border border-line">
        {people.map((p) => (
          <div key={p.id} className="flex items-center gap-2 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <div className="w-44"><BgSelect s={s} value={s.customImages[`person:${p.id}`]} onChange={(id) => pick.mutate({ key: `person:${p.id}`, id })} /></div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-ink-faint">Their background on any mic, any service. Automatic: one named like them, else their Planning Center photo.</p>
    </section>
  );
}
