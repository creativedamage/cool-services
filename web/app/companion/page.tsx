"use client";
/**
 * FOH companion screen. Idle: a calm clock and "no requests". When Kids or Nursery ask for a page,
 * the Mac app brings this window to the front, full screen, with three big buttons. Children's names
 * never reach this screen (the main computer leaves them out). With the mic strip on, this window
 * steps aside between requests and a short bar of the mics sits along the bottom of the screen.
 */
import clsx from "clsx";
import { BellRing, Check, Hand, Link2, Loader2, PanelBottom, Search, Settings, Unlink, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CompanionRequest, CompanionState } from "@shared/types";
import { Api } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { MicStripRow } from "@/components/board/MicStrip";
import { useTileHistory } from "@/components/board/DisplayView";

const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60}s` : ""}`.trim();
};

export default function CompanionPage() {
  const [st, setSt] = useState<CompanionState | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let stop = false;
    const tick = async () => { try { const s = await Api.companionState(); if (!stop) setSt(s); } catch { /* keep last */ } };
    void tick();
    const t = setInterval(() => { void tick(); setNow(Date.now()); }, 1000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  if (!st) return <Shell><Loader2 className="animate-spin text-ink-muted" /></Shell>;
  if (!st.linked) return <LinkWizard onLinked={setSt} />;
  const waiting = st.requests.filter((r) => r.state === "waiting" && !r.heldAt);
  if (waiting.length) return <Takeover r={waiting[0]} more={waiting.length - 1} now={now} onDone={setSt} />;
  return <Idle st={st} now={now} onChange={setSt} />;
}

function Shell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <main className={clsx("flex min-h-screen flex-col items-center justify-center bg-canvas p-8 text-ink", className)}>{children}</main>;
}

/* ── A request: the whole screen, three big buttons ── */
function Takeover({ r, more, now, onDone }: { r: CompanionRequest; more: number; now: number; onDone: (s: CompanionState) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (a: "accept" | "hold" | "deny") => {
    setBusy(a); setErr(null);
    try { onDone(await Api.companionAct(r.id, a)); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const Btn = ({ a, label, sub, icon: Icon, tone }: { a: "accept" | "hold" | "deny"; label: string; sub: string; icon: typeof Check; tone: string }) => (
    <button disabled={Boolean(busy)} onClick={() => act(a)}
      className={clsx("flex min-h-[220px] flex-1 flex-col items-center justify-center gap-3 rounded-3xl text-white shadow-2xl transition active:scale-[0.97] disabled:opacity-60", tone)}>
      {busy === a ? <Loader2 size={56} className="animate-spin" /> : <Icon size={56} strokeWidth={2.5} />}
      <span className="text-4xl font-bold tracking-tight">{label}</span>
      <span className="text-lg opacity-85">{sub}</span>
    </button>
  );
  return (
    <main className="flex min-h-screen flex-col bg-[#1a1206] p-8 text-white">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className="grid h-24 w-24 animate-pulse place-items-center rounded-full bg-warn text-black"><BellRing size={48} /></span>
        <div className="mt-6 text-7xl font-black uppercase tracking-tight">{r.ministry}</div>
        <div className="mt-2 text-3xl font-medium text-white/85">is requesting a page</div>
        <div className="mt-5 flex items-center gap-4 text-xl text-white/70">
          <span>Tag <b className="font-mono text-3xl tracking-[0.2em] text-white">{r.code}</b></span>
          <span>· waiting {ago(r.requestedAt, now)}</span>
          {more > 0 && <span className="rounded-full bg-white/15 px-3 py-1 text-base">+{more} more</span>}
        </div>
        {err && <div className="mt-4 rounded-xl bg-bad/30 px-4 py-2 text-lg">{err}</div>}
      </div>
      <div className="flex gap-6">
        <Btn a="accept" label="Accept" sub="Put it on the screens" icon={Check} tone="bg-emerald-600 hover:bg-emerald-500" />
        <Btn a="hold" label="Hold until clear" sub="Keep it waiting for now" icon={Hand} tone="bg-amber-600 hover:bg-amber-500" />
        <Btn a="deny" label="Deny" sub="Don’t put it up" icon={X} tone="bg-rose-700 hover:bg-rose-600" />
      </div>
    </main>
  );
}

/* ── Nothing waiting ── */
function Idle({ st, now, onChange }: { st: CompanionState; now: number; onChange: (s: CompanionState) => void }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const held = st.requests.filter((r) => r.state === "waiting" && r.heldAt);
  const going = st.requests.filter((r) => r.state === "released");
  const onScreen = st.onScreenUntil ? Math.max(0, Math.ceil((Date.parse(st.onScreenUntil) - now) / 1000)) : 0;
  const act = async (id: string, a: "accept" | "deny") => onChange(await Api.companionAct(id, a));
  return (
    <Shell>
      <div className="absolute right-5 top-5">
        <button className="btn-ghost p-2" onClick={() => setMenu(!menu)} title="Companion settings"><Settings size={20} /></button>
        {menu && (
          <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover" onClick={async () => { onChange(await Api.companionUnlink()); setMenu(false); }}><Unlink size={15} /> Unlink from {st.main?.name}</button>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover" onClick={async () => { await Api.setAppMode("full"); router.replace("/"); }}><Logo size={15} /> Use the full Cool Services</button>
          </div>
        )}
      </div>
      <Logo size={56} />
      <div className="mt-6 font-mono text-8xl font-semibold tabular-nums">{new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
      <div className={clsx("mt-4 flex items-center gap-2 text-lg", st.connected ? "text-ok" : "text-bad")}>
        <span className={clsx("h-2.5 w-2.5 rounded-full", st.connected ? "bg-ok" : "animate-pulse bg-bad")} />
        {st.connected ? `Connected to ${st.main?.name}` : st.error ?? "Reconnecting…"}
      </div>
      <div className="mt-2 text-ink-muted">{onScreen ? `A page is on the screens (${onScreen}s)` : held.length ? `${held.length} request${held.length > 1 ? "s" : ""} on hold` : "No page requests"}</div>
      <StripPanel st={st} now={now} />
      {(held.length > 0 || going.length > 0) && (
        <div className="mt-10 w-full max-w-2xl space-y-3">
          {going.map((r) => (
            <div key={r.id} className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-4 text-lg">
              <Loader2 className="animate-spin text-accent" /> <b>{r.ministry}</b> <span className="font-mono">{r.code}</span> <span className="ml-auto text-ink-muted">going up next</span>
            </div>
          ))}
          {held.map((r) => (
            <div key={r.id} className="flex items-center gap-4 rounded-2xl border border-warn/40 bg-warn-soft px-5 py-4 text-lg">
              <Hand className="text-warn" /> <b>{r.ministry}</b> <span className="font-mono">{r.code}</span> <span className="text-ink-muted">held · {ago(r.requestedAt, now)}</span>
              <button className="ml-auto rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white active:scale-95" onClick={() => act(r.id, "accept")}>Accept</button>
              <button className="rounded-xl bg-rose-700 px-6 py-3 font-semibold text-white active:scale-95" onClick={() => act(r.id, "deny")}>Deny</button>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

/* ── Linking to the main computer ── */
function LinkWizard({ onLinked }: { onLinked: (s: CompanionState) => void }) {
  const router = useRouter();
  const [found, setFound] = useState<{ host: string; port: number; name: string }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<{ host: string; port: number; name: string } | null>(null);
  const [manual, setManual] = useState({ host: "", port: "47130" });
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => { setSearching(true); setErr(null); try { const f = await Api.companionFind(); setFound(f); if (f.length === 1) setPick(f[0]); } catch (e) { setErr((e as Error).message); } finally { setSearching(false); } };
  useEffect(() => { void search(); }, []);
  const target = pick ?? (manual.host ? { host: manual.host, port: Number(manual.port) || 47130, name: manual.host } : null);
  const link = async () => {
    if (!target) return;
    setBusy(true); setErr(null);
    try { onLinked(await Api.companionLink(target.host, target.port, code)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-3"><Logo size={36} /><div><div className="text-xl font-semibold">Link to your main Cool Services computer</div><div className="text-sm text-ink-muted">FOH companion</div></div></div>
        <ol className="space-y-5">
          <li className="panel p-5">
            <div className="flex items-center justify-between">
              <span className="font-semibold">1 · Find it on the network</span>
              <button className="btn-ghost py-1 text-xs" onClick={search} disabled={searching}>{searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Search again</button>
            </div>
            <p className="mt-1 text-sm text-ink-muted">On the main computer, open Preferences → Network Connections → <b>FOH companions</b> and press <b>Pair a companion</b>.</p>
            <div className="mt-3 space-y-1.5">
              {searching && !found && <div className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 size={14} className="animate-spin" /> Looking…</div>}
              {found?.map((f) => (
                <button key={`${f.host}:${f.port}`} onClick={() => setPick(f)}
                  className={clsx("flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left", pick?.host === f.host ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}>
                  <Link2 size={16} className="text-accent" /> <span className="font-medium">{f.name}</span> <span className="ml-auto font-mono text-xs text-ink-muted">{f.host}:{f.port}</span>
                </button>
              ))}
              {found && !found.length && <p className="text-sm text-ink-muted">Nothing found yet. Check the main computer is showing a pairing code, or type its address:</p>}
              {found && (
                <div className="flex gap-2 pt-1">
                  <input className="input font-mono text-sm" placeholder="Main computer IP (e.g. 10.0.1.20)" value={manual.host} onChange={(e) => { setPick(null); setManual({ ...manual, host: e.target.value.trim() }); }} />
                  <input className="input w-24 font-mono text-sm" value={manual.port} onChange={(e) => setManual({ ...manual, port: e.target.value.replace(/\D/g, "") })} />
                </div>
              )}
            </div>
          </li>
          <li className="panel p-5">
            <span className="font-semibold">2 · Enter the pairing code</span>
            <input className="input mt-3 py-4 text-center font-mono text-4xl tracking-[0.5em]" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            {err && <p className="mt-2 text-sm text-bad">{err}</p>}
            <button className="btn-primary mt-4 w-full py-3 text-base" disabled={!target || code.length !== 6 || busy} onClick={link}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />} Link</button>
          </li>
        </ol>
        <button className="mt-6 text-xs text-ink-muted hover:text-accent" onClick={async () => { await Api.setAppMode("full"); router.replace("/"); }}>Use the full Cool Services on this Mac instead</button>
      </div>
    </Shell>
  );
}

/* ── The mic strip: preview and settings ── */
function StripPanel({ st, now }: { st: CompanionState; now: number }) {
  const [cfg, setCfg] = useState<Awaited<ReturnType<typeof Api.companionStrip>> | null>(null);
  useEffect(() => { void Api.companionStrip().then(setCfg).catch(() => undefined); }, []);
  const history = useTileHistory(st.mics, String(now));
  const save = async (p: Parameters<typeof Api.saveCompanionStrip>[0]) => setCfg(await Api.saveCompanionStrip(p));
  const s = cfg?.settings ?? st.strip;
  return (
    <div className="mt-10 w-full max-w-5xl rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <PanelBottom size={18} className="text-accent" />
        <span className="font-semibold">Mic strip</span>
        <span className="text-sm text-ink-muted">Along the bottom of the screen between page requests; everything above it stays clickable.</span>
      </div>
      <div className="h-[150px]">
        {st.mics.length ? <MicStripRow tiles={st.mics} now={now} history={history} />
          : <div className="grid h-full place-items-center rounded-xl bg-[#222] text-sm text-[#8A8A8A]">No mics on the main computer’s mic board yet</div>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.enabled} onChange={(e) => void save({ enabled: e.target.checked })} /> Show the mic strip</label>
        <label className="flex items-center gap-2"><span className="text-ink-muted">Height</span>
          <select className="input w-28 py-1" value={s.size} onChange={(e) => void save({ size: e.target.value as "m" })}>
            <option value="s">Short</option><option value="m">Medium</option><option value="l">Tall</option>
          </select>
        </label>
        {(cfg?.displays.length ?? 0) > 1 && (
          <label className="flex items-center gap-2"><span className="text-ink-muted">Display</span>
            <select className="input w-56 py-1" value={s.displayId ?? ""} onChange={(e) => void save({ displayId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Main display</option>
              {cfg!.displays.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
        )}
        {s.enabled && <button className="btn-primary ml-auto" onClick={() => void Api.companionWindow("strip")}><PanelBottom size={15} /> Back to the mic strip</button>}
      </div>
      <p className="mt-2 text-xs text-ink-faint">Which mics show, and stacking a person’s mics, follow the main computer’s Mic board → Display settings. Hover the strip and press the gear (or click Cool Services in the Dock) to come back here.</p>
    </div>
  );
}
