"use client";
/**
 * Mic board & stage display. Choose what the display shows (Auto: the mic board around rehearsals and
 * services; or pick one), change the banner message, and set pictures. The preview is exactly
 * what the network display and the second display show.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Copy, Eye, EyeOff, ImagePlus, Plus, Trash2, WifiOff, MicVocal, MonitorUp, RotateCcw, Settings2, Sparkles, Timer, Tv, Wifi, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { BoardMic, BoardSettings, DisplayMode } from "@shared/board";
import { Api } from "@/lib/api";
import { openPrefs } from "@/lib/prefs";
import { DisplayView } from "@/components/board/DisplayView";
import { Drawer, Spinner } from "@/components/ui";

const KEY = ["stageDisplay"];
const MODES: { mode: DisplayMode; label: string; icon: typeof Tv; hint: string }[] = [
  { mode: "auto", label: "Auto", icon: Sparkles, hint: "The mic board from before each rehearsal and service until it ends (from Planning Center); otherwise your idle choice" },
  { mode: "micboard", label: "Mic board", icon: MicVocal, hint: "Always the mic board" },
  { mode: "clock", label: "Clock", icon: Timer, hint: "The production clock" },
];
const VIEW_NAME = { micboard: "Mic board", clock: "Clock" } as const;

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
          This is what the display shows. The mic board is Micboard (click into it to use it; press s there for its settings). Who’s on each mic comes from the service’s Mics panel.
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
          <div className="flex rounded-lg border border-line p-0.5">
            {([["weekend", "The weekend’s service"], ["open", "The service I have open"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => onSave({ follow: v })}
                className={clsx("flex-1 rounded-md px-2 py-1.5 text-xs", (s.follow ?? "weekend") === v ? "bg-accent text-white" : "text-ink-soft hover:bg-hover")}>{label}</button>
            ))}
          </div>
          {(s.follow ?? "weekend") === "weekend" && (
            <p className="text-[11px] text-ink-faint">Uses the weekend picked in the sidebar. It stays on that weekend until someone picks another.{data.state.service ? <> Now: <span className="text-ink-soft">{data.state.service.serviceTypeName} · {data.state.service.when}</span></> : null}</p>
          )}
          {(s.follow ?? "weekend") === "open" && (
            <p className="text-[11px] text-ink-faint">Open a service under Services and the board switches to it.{data.state.service ? <> Now: <span className="text-ink-soft">{data.state.service.serviceTypeName} · {data.state.service.when}</span></> : null}</p>
          )}
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

        <MicboardDisplaySection s={s} onSave={onSave} />

        <MicsSection s={s} mics={data.mics} onSave={onSave} />

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

/** Show or hide each mic, stack a person's mics on one tile, and add mics that aren't on the network. */
function MicsSection({ s, mics, onSave }: {
  s: BoardSettings; mics: BoardMic[]; onSave: (p: Parameters<typeof Api.saveBoard>[0]) => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<BoardMic["kind"]>("pack");
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const add = useMutation({
    mutationFn: () => Api.addBoardMic(label.trim(), kind),
    onSuccess: () => { setLabel(""); void refresh(); toast.success("Mic added", { description: "Put someone on it in the service’s Mics panel." }); },
    onError: (e) => toast.error("Couldn’t add the mic", { description: (e as Error).message }),
  });
  const del = useMutation({ mutationFn: Api.removeBoardMic, onSuccess: () => void refresh() });
  const hidden = new Set(s.hidden ?? []);
  const toggle = (id: string) => onSave({ hidden: hidden.has(id) ? [...hidden].filter((x) => x !== id) : [...hidden, id] });

  return (
    <section className="space-y-2">
      <h3 className="label">FOH companion mic strip</h3>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={s.stack ?? true} onChange={(e) => onSave({ stack: e.target.checked })} />
        <span>One tile per person <span className="block text-[11px] text-ink-faint">Someone on more than one mic (a vocal and their acoustic guitar’s pack) gets one tile, with the other mics stacked under their mic name.</span></span>
      </label>
      <div className="divide-y divide-line rounded-lg border border-line">
        {mics.length === 0 && <p className="px-3 py-2 text-xs text-ink-muted">No mics yet. Add receivers in Settings → Mic setup, or add a mic below.</p>}
        {mics.map((m) => (
          <div key={m.id} className={clsx("flex items-center gap-2 px-3 py-1.5", hidden.has(m.id) && "opacity-50")}>
            <button className="btn-ghost p-1" title={hidden.has(m.id) ? "Show on the board" : "Hide from the board"} onClick={() => toggle(m.id)}>
              {hidden.has(m.id) ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <span className="min-w-0 flex-1 truncate">{m.label}</span>
            <span className="text-[11px] text-ink-faint">{m.kind === "vocal" ? "Vocal" : m.kind === "pack" ? "Pack" : "Other"}</span>
            {m.networked
              ? <span className="flex items-center gap-1 text-[11px] text-ok" title="Read from its receiver"><Wifi size={11} /> Network</span>
              : <>
                  <span className="flex items-center gap-1 text-[11px] text-ink-muted" title="Not on the network: shows who has it, no battery or RF"><WifiOff size={11} /> Not networked</span>
                  <button className="btn-ghost p-1 text-ink-muted hover:text-bad" title="Remove this mic" onClick={() => del.mutate(m.id)}><Trash2 size={13} /></button>
                </>}
          </div>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (label.trim()) add.mutate(); }}>
        <input className="input flex-1" placeholder="Add a mic that isn’t on the network (e.g. AG 1)" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
        <select className="input w-24" value={kind} onChange={(e) => setKind(e.target.value as BoardMic["kind"])}>
          <option value="vocal">Vocal</option><option value="pack">Pack</option><option value="other">Other</option>
        </select>
        <button className="btn-primary px-3" disabled={!label.trim() || add.isPending}><Plus size={14} /></button>
      </form>
      <p className="text-[11px] text-ink-faint">Who’s on each mic comes from the service’s Mics panel, so put Adam on “AG 1” there and it stacks onto his tile.</p>
    </section>
  );
}

/** How the display shows Micboard: group, TV view and info drawer, backgrounds. */
function MicboardDisplaySection({ s, onSave }: { s: BoardSettings; onSave: (p: Parameters<typeof Api.saveBoard>[0]) => void }) {
  const mb = useQuery({ queryKey: ["micboard"], queryFn: Api.micboard, refetchInterval: 5000 });
  const m = s.micboard;
  const set = (p: Partial<BoardSettings["micboard"]>) => onSave({ micboard: { ...m, ...p } });
  return (
    <section className="space-y-2">
      <h3 className="label">Mic board (Micboard)</h3>
      <p className="text-[11px] text-ink-faint">
        The mic board is Micboard, running inside Sundays{mb.data?.status.version ? ` (version ${mb.data.status.version})` : ""}. Set up receivers, groups and names in Micboard itself (press <b>s</b> for its settings);
        names, Planning Center photos and your own backgrounds are in <button className="text-accent hover:underline" onClick={() => void openPrefs("micboard")}>Preferences → Micboard</button>.
      </p>
      <label className="block"><span className="text-xs text-ink-muted">Group</span>
        <select className="input mt-1" value={m.group} onChange={(e) => set({ group: Number(e.target.value) })}>
          <option value={0}>All mics</option>
          {(mb.data?.groups ?? []).map((g) => <option key={g.group} value={g.group}>{g.group}: {g.title || "Untitled"} ({g.slots})</option>)}
        </select>
      </label>
      <label className="block"><span className="text-xs text-ink-muted">View</span>
        <select className="input mt-1" value={m.view} onChange={(e) => set({ view: e.target.value as BoardSettings["micboard"]["view"] })}>
          <option value="elinfo11">TV: names, status bar and details</option>
          <option value="elinfo10">TV: names and details</option>
          <option value="elinfo01">TV: names and status bar</option>
          <option value="elinfo00">TV: names only</option>
          <option value="desk">Desk view</option>
        </select>
      </label>
      {m.view !== "desk" && (
        <label className="block"><span className="text-xs text-ink-muted">Backgrounds behind the names</span>
          <div className="mt-1 flex rounded-lg border border-line p-0.5">
            {([["IMG", "Pictures"], ["MP4", "Videos"], ["NONE", "None"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => set({ backgrounds: v })}
                className={clsx("flex-1 rounded-md px-2 py-1.5 text-xs", m.backgrounds === v ? "bg-accent text-white" : "text-ink-soft hover:bg-hover")}>{label}</button>
            ))}
          </div>
        </label>
      )}
    </section>
  );
}
