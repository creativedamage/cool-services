"use client";
/**
 * The Kids / Nursery iPad page, served on the church network at http://<this Mac>:47130/nursery
 * (or /kids). Locked with that ministry's PIN. Shows the children checked in to that ministry's
 * rooms; tap a child, then "Page the Auditorium" to put their security code on the screens.
 */
import clsx from "clsx";
import { BellRing, Check, Clock, Delete, Keyboard, Lock, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KioskChild, KioskChildren, KioskInfo, Ministry, PageRequest, PagingStatus } from "@shared/types";
import { useOnScreenSeconds } from "@/lib/paging";

class KErr extends Error { constructor(public status: number, message: string, public data?: any) { super(message); } }

function useMinistry(): Ministry | null | undefined {
  const [m, setM] = useState<Ministry | null | undefined>(undefined);
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("m");
    const p = location.pathname.replace(/\/+$/, "").split("/").pop();
    const pick = [q, p].find((x) => x === "nursery" || x === "kids") as Ministry | undefined;
    setM(pick ?? null);
  }, []);
  return m;
}

async function k<T>(m: Ministry, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/kiosk/${m}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new KErr(res.status, data?.message ?? data?.error ?? "Something went wrong", data);
  return data as T;
}

/** Follow the iPad's own light/dark setting. */
function useSystemTheme() {
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: light)");
    const apply = () => { document.documentElement.dataset.theme = mq.matches ? "light" : "dark"; };
    apply();
    const t = setTimeout(apply, 300); // after the app-wide theme loader
    mq.addEventListener("change", apply);
    return () => { clearTimeout(t); mq.removeEventListener("change", apply); };
  }, []);
}

export default function KioskPage() {
  useSystemTheme();
  const m = useMinistry();
  const [info, setInfo] = useState<KioskInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!m) return;
    k<KioskInfo>(m, "info").then((i) => { setInfo(i); setErr(null); }).catch((e) => setErr((e as Error).message));
  }, [m]);
  useEffect(load, [load]);

  if (m === undefined) return <Shell />;
  if (m === null) return <Chooser />;
  if (err) return <Shell><Centered><p className="text-ink-soft">Can’t reach Sundays.</p><p className="mt-1 text-sm text-ink-muted">Make sure the Mac running Sundays is on and awake.</p><button className="btn-outline mt-6" onClick={load}>Try again</button></Centered></Shell>;
  if (!info) return <Shell />;
  if (!info.enabled) return <Shell><Centered><p className="text-ink-soft">{info.title} paging is turned off.</p><p className="mt-1 text-sm text-ink-muted">A staff member can turn it on in Sundays → Settings.</p></Centered></Shell>;
  if (!info.unlocked) return <PinPad m={m} info={info} onUnlocked={load} />;
  return <Board m={m} info={info} onLocked={load} />;
}

function Shell({ children }: { children?: React.ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-col bg-canvas text-ink" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>{children}</div>;
}
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="m-auto flex max-w-md flex-col items-center p-8 text-center">{children}</div>;
}

function Chooser() {
  return (
    <Shell>
      <Centered>
        <BellRing className="text-accent" size={32} />
        <h1 className="mt-3 text-2xl font-semibold">Page the Auditorium</h1>
        <p className="mt-1 text-sm text-ink-muted">Choose this iPad’s ministry. You’ll need its PIN.</p>
        <div className="mt-8 grid w-72 gap-3">
          <a href="/nursery" className="btn-primary justify-center py-4 text-lg">Nursery</a>
          <a href="/kids" className="btn-outline justify-center py-4 text-lg">Kids</a>
        </div>
      </Centered>
    </Shell>
  );
}

/* ───────────── PIN ───────────── */

function PinPad({ m, info, onUnlocked }: { m: Ministry; info: KioskInfo; onUnlocked: () => void }) {
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const submit = async (p = pin) => {
    if (p.length < 4 || busy) return;
    setBusy(true);
    try {
      await k(m, "unlock", { pin: p });
      onUnlocked();
    } catch (e) {
      setMsg((e as Error).message);
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 400);
    } finally { setBusy(false); }
  };
  const press = (d: string) => { setMsg(null); setPin((p) => (p.length < 8 ? p + d : p)); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter") void submit();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  return (
    <Shell>
      <Centered>
        <Brand info={info} />
        <h1 className="mt-6 text-3xl font-semibold">{info.title}</h1>
        <p className="mt-1 text-ink-muted">Enter the {info.title} PIN</p>
        <div className={clsx("mt-6 flex h-5 gap-3", shake && "animate-[shake_0.35s]")}>
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <span key={i} className={clsx("h-4 w-4 rounded-full border-2 transition", i < pin.length ? "border-accent bg-accent" : "border-line-strong")} />
          ))}
        </div>
        <p className="mt-3 h-5 text-sm text-bad">{msg}</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <Key key={d} onClick={() => press(d)}>{d}</Key>)}
          <Key onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete"><Delete size={22} /></Key>
          <Key onClick={() => press("0")}>0</Key>
          <Key onClick={() => void submit()} disabled={pin.length < 4 || busy} primary aria-label="Unlock"><Check size={24} /></Key>
        </div>
      </Centered>
    </Shell>
  );
}

function Key({ children, primary, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button {...rest} className={clsx("grid h-20 w-20 place-items-center rounded-full text-2xl font-medium transition active:scale-95 disabled:opacity-30",
      primary ? "bg-accent text-white" : "bg-raised text-ink hover:bg-hover")}>
      {children}
    </button>
  );
}

function Brand({ info }: { info: KioskInfo }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {info.logo && <img src={info.logo} alt="" className="h-7 w-7 rounded-lg object-contain" />}
      {info.church}
    </div>
  );
}

/* ───────────── Children + paging ───────────── */

function Board({ m, info, onLocked }: { m: Ministry; info: KioskInfo; onLocked: () => void }) {
  const [kids, setKids] = useState<KioskChildren | null>(null);
  const [status, setStatus] = useState<PagingStatus | undefined>();
  const [statusAt, setStatusAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<KioskChild | null>(null);
  const [manual, setManual] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const onScreenLeft = useOnScreenSeconds(status, statusAt);
  // With approval on, the iPad only asks: the screen being busy doesn't stop a request.
  const left = info.approval ? 0 : onScreenLeft;
  const locked = onScreenLeft > 0;

  const onErr = useCallback((e: unknown) => {
    if (e instanceof KErr && e.status === 401) return onLocked();
    setError((e as Error).message);
  }, [onLocked]);

  const loadKids = useCallback(() => k<KioskChildren>(m, "children").then((d) => { setKids(d); setError(null); }).catch(onErr), [m, onErr]);
  const loadStatus = useCallback(() => k<PagingStatus>(m, "status").then((s) => { setStatus(s); setStatusAt(Date.now()); }).catch(() => {}), [m]);
  useEffect(() => { void loadKids(); const t = setInterval(loadKids, 10_000); return () => clearInterval(t); }, [loadKids]);
  const lockedRef = useRef(false);
  lockedRef.current = locked;
  // Every second while something's on screen (so the button unlocks on time), otherwise every 3s.
  useEffect(() => {
    let stop = false;
    let t: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await loadStatus();
      if (!stop) t = setTimeout(loop, lockedRef.current ? 1000 : 3000);
    };
    void loop();
    return () => { stop = true; clearTimeout(t); };
  }, [loadStatus]);

  const send = async (body: { checkInId?: string; code?: string }, label: string) => {
    try {
      const r = await k<{ status: PagingStatus; requested?: boolean }>(m, "page", body);
      setStatus(r.status); setStatusAt(Date.now());
      setPicked(null); setManual(false);
      setDone(r.requested ? `${label.replace(/^Paged/, "Requested")}. The auditorium will put it up.` : label);
      setTimeout(() => setDone(null), 4000);
    } catch (e) {
      if (e instanceof KErr && e.data?.status) { setStatus(e.data.status); setStatusAt(Date.now()); }
      if (e instanceof KErr && e.status === 401) return onLocked();
      throw e;
    }
  };

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (kids?.children ?? []).filter((c) => !s || c.name.toLowerCase().includes(s) || c.securityCode?.toLowerCase() === s || c.room.toLowerCase().includes(s));
  }, [kids, q]);
  const rooms = [...new Set((kids?.children ?? []).map((c) => c.room))];
  const current = status?.current;

  return (
    <Shell>
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="flex items-center gap-4 px-5 py-3">
          <div className="min-w-0">
            <Brand info={info} />
            <h1 className="text-2xl font-semibold leading-tight">{info.title}</h1>
          </div>
          <div className="relative ml-auto w-full max-w-sm">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="input py-3 pl-10 text-base" placeholder="Find a child, room or code" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="btn-outline py-3" onClick={() => setManual(true)}><Keyboard size={18} /> Enter a code</button>
          <button className="btn-ghost p-3" title="Lock this iPad" onClick={() => { if (confirm("Lock this iPad? You'll need the PIN to open it again.")) void k(m, "lock", {}).then(onLocked); }}>
            <Lock size={18} />
          </button>
        </div>
        {locked && current ? (
          <div className="flex items-center gap-3 bg-warn-soft px-5 py-2.5 text-warn">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-warn" />
            <span className="font-medium">On the screens now: <b className="font-mono tracking-wider">{current.code}</b></span>
            <span className="ml-auto tabular-nums">{info.approval ? `${onScreenLeft}s` : `You can page again in ${onScreenLeft}s`}</span>
          </div>
        ) : done ? (
          <div className="flex items-center gap-2 bg-ok-soft px-5 py-2.5 font-medium text-ok"><Check size={18} /> {done}</div>
        ) : null}
      </header>

      <main className="flex-1 p-5">
        {error && <div className="mb-4 rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-bad">{error}</div>}
        {!kids ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-hover/70" />)}</div>
        ) : kids.children.length === 0 ? (
          <Centered>
            <p className="text-lg text-ink-soft">No children checked in yet</p>
            <p className="mt-1 text-sm text-ink-muted">This page updates on its own. {rooms.length === 0 && "If children are checked in, ask a staff member to choose this ministry’s rooms in Settings."}</p>
          </Centered>
        ) : (
          <>
            <div className="mb-3 text-sm text-ink-muted">{kids.children.length} checked in{rooms.length > 1 ? ` · ${rooms.join(", ")}` : rooms[0] ? ` · ${rooms[0]}` : ""}</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {list.map((c) => (
                <button key={c.id} onClick={() => setPicked(c)}
                  className="flex items-center gap-3 rounded-2xl border border-line bg-raised p-4 text-left transition active:scale-[0.98] hover:border-accent/50">
                  <KidAvatar c={c} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-lg font-semibold leading-tight">{c.name}</div>
                    <div className="mt-0.5 truncate text-sm text-ink-muted">{c.room}{c.guest ? " · Guest" : ""}</div>
                    {c.securityCode && <div className="mt-1.5 inline-block rounded-md bg-hover px-2 py-0.5 font-mono text-sm tracking-wider text-ink-soft">{c.securityCode}</div>}
                  </div>
                </button>
              ))}
            </div>
            {list.length === 0 && <p className="mt-10 text-center text-ink-muted">No one matches “{q}”.</p>}
          </>
        )}
        {info.approval && <Requests status={status} />}
        <Recent status={status} />
      </main>

      {picked && (
        <ConfirmSheet title={picked.name} subtitle={`${picked.room}${picked.securityCode ? ` · Tag ${picked.securityCode}` : ""}`} code={picked.securityCode}
          left={left} approval={info.approval} onClose={() => setPicked(null)}
          onPage={() => send({ checkInId: picked.id }, `Paged ${picked.securityCode} for ${picked.name.split(" ")[0]}`)} />
      )}
      {manual && <ManualSheet left={left} approval={info.approval} onClose={() => setManual(false)} onPage={(code) => send({ code }, `Paged ${code}`)} />}
    </Shell>
  );
}

function KidAvatar({ c }: { c: KioskChild }) {
  const [broken, setBroken] = useState(false);
  const initials = c.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  // eslint-disable-next-line @next/next/no-img-element
  if (c.avatarUrl && !broken) return <img src={c.avatarUrl} alt="" onError={() => setBroken(true)} className="h-14 w-14 shrink-0 rounded-full bg-hover object-cover" />;
  return <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent-soft text-lg font-semibold text-accent">{initials}</div>;
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md animate-fade-up rounded-3xl border border-line bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function PageButton({ left, busy, disabled, approval, onClick }: { left: number; busy: boolean; disabled?: boolean; approval?: boolean; onClick: () => void }) {
  const locked = left > 0;
  return (
    <button disabled={locked || busy || disabled} onClick={onClick}
      className={clsx("mt-6 flex w-full items-center justify-center gap-3 rounded-2xl py-5 text-xl font-semibold transition active:scale-[0.98]",
        locked ? "bg-hover text-ink-muted" : "bg-accent text-white disabled:opacity-40")}>
      <BellRing size={24} />
      {busy ? (approval ? "Sending request…" : "Paging…") : locked ? `Screens busy · ${left}s` : approval ? "Request a Page" : "Page the Auditorium"}
    </button>
  );
}

function ConfirmSheet({ title, subtitle, code, left, approval, onClose, onPage }: {
  title: string; subtitle: string; code: string | null; left: number; approval: boolean; onClose: () => void; onPage: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet onClose={onClose}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-2xl font-semibold">{title}</div>
          <div className="mt-1 text-ink-muted">{subtitle}</div>
        </div>
        <button className="btn-ghost -mr-2 p-2" onClick={onClose} aria-label="Close"><X size={22} /></button>
      </div>
      {code ? (
        <p className="mt-5 rounded-xl bg-hover px-4 py-3 text-center text-ink-soft">
          The screens will show <b className="font-mono text-lg tracking-wider text-ink">{code}</b>
          {approval && <span className="mt-1 block text-sm text-ink-muted">The auditorium team puts it up at the right moment in the service.</span>}
        </p>
      ) : <p className="mt-5 text-bad">This child has no security code, so they can’t be paged from here.</p>}
      {err && <p className="mt-3 text-sm text-bad">{err}</p>}
      <PageButton left={left} busy={busy} disabled={!code} approval={approval} onClick={async () => {
        setBusy(true); setErr(null);
        try { await onPage(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      }} />
    </Sheet>
  );
}

function ManualSheet({ left, approval, onClose, onPage }: { left: number; approval: boolean; onClose: () => void; onPage: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet onClose={onClose}>
      <div className="flex items-start justify-between">
        <div className="text-2xl font-semibold">Enter a tag code</div>
        <button className="btn-ghost -mr-2 p-2" onClick={onClose} aria-label="Close"><X size={22} /></button>
      </div>
      <input autoFocus autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={8} value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())}
        className="input mt-5 py-4 text-center font-mono text-3xl tracking-[0.3em]" placeholder="K7X4" />
      {err && <p className="mt-3 text-sm text-bad">{err}</p>}
      <PageButton left={left} busy={busy} disabled={!code} approval={approval} onClick={async () => {
        setBusy(true); setErr(null);
        try { await onPage(code); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      }} />
    </Sheet>
  );
}

function Recent({ status }: { status: PagingStatus | undefined }) {
  const list = status?.recent ?? [];
  if (!list.length) return null;
  return (
    <section className="mt-8">
      <h2 className="label mb-2">Paged today</h2>
      <ul className="divide-y divide-line/60 rounded-2xl border border-line bg-raised">
        {list.slice(0, 8).map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            {e.ok ? <Check size={15} className="text-ok" /> : <X size={15} className="text-bad" />}
            <span className="font-mono tracking-wider">{e.code}</span>
            <span className="text-ink-muted">{e.childName ?? ""}</span>
            <span className="ml-auto tabular-nums text-ink-muted">{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            {!e.ok && <span className="text-xs text-bad">{e.error}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** This ministry's requests today: waiting for the auditorium, on the screens, or not sent. */
function Requests({ status }: { status: PagingStatus | undefined }) {
  const list = status?.requests ?? [];
  if (!list.length) return null;
  const label = (r: PageRequest) => r.state === "waiting" ? "Waiting for the auditorium"
    : r.state === "released" ? "Going up next" : r.state === "sent" ? "On the screens" : r.state === "cancelled" ? "Not sent" : "Couldn’t be paged";
  return (
    <section className="mt-8">
      <h2 className="label mb-2">Requests today</h2>
      <ul className="divide-y divide-line/60 rounded-2xl border border-line bg-raised">
        {list.slice(0, 10).map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            {r.state === "sent" ? <Check size={15} className="text-ok" /> : r.state === "waiting" || r.state === "released" ? <Clock size={15} className="animate-pulse text-warn" /> : <X size={15} className="text-ink-faint" />}
            <span className="font-mono tracking-wider">{r.code}</span>
            <span className="text-ink-muted">{r.childName ?? ""}</span>
            <span className={clsx("ml-auto text-xs", r.state === "waiting" || r.state === "released" ? "text-warn" : r.state === "sent" ? "text-ok" : "text-ink-muted")}>{label(r)}</span>
            <span className="w-16 text-right tabular-nums text-ink-muted">{new Date(r.requestedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
