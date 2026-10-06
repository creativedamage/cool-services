"use client";
/**
 * Sign-in for Sundays | Operations and Sundays | AVL (one account opens whichever apps you're given).
 * Everyone has their own account (email + password, kept by Sundays' cloud). New accounts wait until
 * a manager approves them; the very first account is the System admin.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, AudioLines, Building2, Clock3, KeyRound, LogOut, Mail, RefreshCw, ShieldCheck, ShieldHalf, UserPlus } from "lucide-react";
import { CreateOrgForm } from "./Plans";
import { OrgList } from "./OrgSwitcher";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { OpsMe } from "@shared/ops/types";
import { Api, qk } from "@/lib/api";
import { confirmRedirect, ops, opsSignOut, STANDALONE, supabase, useOpsMe, useOpsSession } from "@/lib/ops";
import { OpsMeContext } from "./context";
import { Spinner } from "@/components/ui";

export type OpsApp = "ops" | "avl";
const APP_NAME: Record<OpsApp, string> = { ops: "Operations", avl: "AVL" };

/** An Operations or AVL page: sign-in, approval, then access to this app, then the page. */
export function OpsAppBody({ app, children }: { app: OpsApp; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OpsGate app={app}>
        {(me) => {
          const allowed = app === "ops" ? me.nav.ops : me.nav.avl;
          return (
            <OpsMeContext.Provider value={me}>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {allowed ? <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">{children}</div> : <NoAccess app={app} me={me} />}
              </div>
            </OpsMeContext.Provider>
          );
        }}
      </OpsGate>
    </div>
  );
}

function NoAccess({ app, me }: { app: OpsApp; me: Extract<OpsMe, { status: "ok" }> }) {
  const other: OpsApp = app === "ops" ? "avl" : "ops";
  const hasOther = other === "ops" ? me.nav.ops : me.nav.avl;
  const router = useRouter();
  // Only has the other app: go straight there.
  useEffect(() => { if (hasOther) router.replace(`/${other}`); }, [hasOther, other, router]);
  return (
    <Center>
      <div className="panel max-w-md p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-hover text-ink-muted">{app === "ops" ? <Building2 size={22} /> : <AudioLines size={22} />}</div>
        <h1 className="mt-4 text-lg font-semibold">You don&apos;t have {APP_NAME[app]} access</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {app === "ops" ? "Sundays | Operations is for the church's own staff. A manager can turn it on for you." : "Sundays | AVL is for the AVL team. An AVL Manager can give you access."}
        </p>
        {hasOther && <Link href={`/${other}`} className="btn-primary mt-5 inline-flex">Open {APP_NAME[other]} <ArrowRight size={14} /></Link>}
      </div>
    </Center>
  );
}

export function OpsGate({ app = "ops", children }: { app?: OpsApp; children: (me: Extract<OpsMe, { status: "ok" }>) => React.ReactNode }) {
  const { session } = useOpsSession();
  const me = useOpsMe(Boolean(session));
  const qc = useQueryClient();
  // In the Mac app, the church's name comes from Planning Center; the website doesn't have it.
  const sundaysMe = useQuery({ queryKey: qk.me, queryFn: Api.me, staleTime: Infinity, enabled: !STANDALONE });

  // First time: the church's name from Planning Center (it's never typed into the code).
  const m = me.data;
  useEffect(() => {
    if (m?.status === "ok" && !m.org.name && sundaysMe.data?.orgName) {
      void ops("/bootstrap", { json: { orgName: sundaysMe.data.orgName } }).then(() => qc.invalidateQueries({ queryKey: ["ops"] })).catch(() => undefined);
    }
  }, [m, sundaysMe.data?.orgName, qc]);

  if (session === undefined || (session && me.isLoading)) return <Center><Spinner size={18} /></Center>;
  if (!session || (me.error && (me.error as { status?: number }).status === 401)) return <SignIn app={app} churchName={sundaysMe.data?.orgName ?? null} />;
  if (me.error) return <Center><p className="max-w-sm text-center text-sm text-bad">{(me.error as Error).message}</p><Retry onClick={() => void me.refetch()} /></Center>;
  if (!m) return null;
  if (m.status === "no-org") return <Welcome me={m} />;
  if (m.status === "suspended") return <Suspended me={m} />;
  if (m.status === "pending" || m.status === "inactive") return <Waiting me={m} onCheck={() => void me.refetch()} checking={me.isFetching} />;
  if (m.status !== "ok") return null;
  return <>{children(m)}</>;
}

const Center = ({ children }: { children: React.ReactNode }) => <div className="grid flex-1 place-items-center p-8"><div className="flex flex-col items-center gap-3">{children}</div></div>;
const Retry = ({ onClick }: { onClick: () => void }) => <button className="btn-outline" onClick={onClick}><RefreshCw size={14} /> Try again</button>;

const PITCH: Record<OpsApp, { icon: typeof Building2; blurb: (church: string) => string; points: [string, string][] }> = {
  ops: {
    icon: Building2, blurb: (c) => `${c} requests, facilities and teams, in one place.`,
    points: [
      ["Ask for anything", "Technology, supplies and building repairs, routed to the right team at your campus."],
      ["Work the queue", "Approve, assign, start, hold and finish, with every step on the record."],
      ["Run the church's business", "People, teams, campuses and request types, with access for each person."],
    ],
  },
  avl: {
    icon: AudioLines, blurb: () => "Audio, video and lighting quoting for the churches you work with.",
    points: [
      ["Keep your clients", "Every church you work with, its contacts and its history."],
      ["Quote with confidence", "Vendor price lists, your own products, margins and proposals they can print."],
      ["Know your numbers", "Pipeline, accepted sales and projected profit at a glance."],
    ],
  },
};

export function SignIn({ app, churchName }: { app: OpsApp; churchName: string | null }) {
  const pitch = PITCH[app];
  const qc = useQueryClient();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // After creating an account: wait for the email link, then sign in by ourselves.
  const [waiting, setWaiting] = useState<{ email: string; password: string } | null>(null);
  useEffect(() => {
    if (!waiting) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      const sb = await supabase();
      const { error } = await sb.auth.signInWithPassword(waiting);
      if (!error) { await qc.invalidateQueries({ queryKey: ["ops"] }); return; }
      if (Date.now() - started < 30 * 60_000) setTimeout(tick, 4000);
    };
    const t = setTimeout(tick, 4000);
    return () => { stop = true; clearTimeout(t); };
  }, [waiting, qc]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const sb = await supabase();
      if (mode === "in") {
        const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
        if (error) throw new Error(/confirm/i.test(error.message) ? "Confirm your email first: open the link we emailed you, then sign in." : error.message);
        await qc.invalidateQueries({ queryKey: ["ops"] });
      } else {
        if (f.password.length < 8) throw new Error("Use at least 8 characters for your password.");
        const { data, error } = await sb.auth.signUp({ email: f.email.trim(), password: f.password, options: { data: { name: f.name.trim() }, emailRedirectTo: confirmRedirect() } });
        if (error) throw error;
        if (!data.session) setWaiting({ email: f.email.trim(), password: f.password });
        else await qc.invalidateQueries({ queryKey: ["ops"] });
      }
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div className="grid flex-1 place-items-center overflow-y-auto p-4 sm:p-8">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface shadow-lift md:grid-cols-[1.1fr_1fr]">
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-accent/25 via-violet/15 to-transparent p-8 md:flex">
          <div>
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-on-accent"><pitch.icon size={22} /></div>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight">Sundays <span className="font-normal text-ink-muted">|</span> {APP_NAME[app]}</h2>
            <p className="mt-1 text-sm text-ink-soft">{pitch.blurb(churchName ? `${churchName}'s` : "Your church's")}</p>
          </div>
          <ul className="space-y-3 text-sm text-ink-soft">
            {pitch.points.map(([t, d]) => (
              <li key={t} className="flex gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /><span><b className="text-ink">{t}.</b> {d}</span></li>
            ))}
          </ul>
        </div>
        {waiting ? (
          <div className="flex flex-col justify-center gap-4 p-8 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent"><Spinner size={18} /></div>
            <h1 className="text-xl font-semibold">Check your email</h1>
            <p className="text-sm text-ink-muted">We sent a link to <b className="text-ink">{waiting.email}</b>. Open it to confirm your address; this screen carries on by itself as soon as you do.</p>
            <p className="text-xs text-ink-faint">Nothing in your inbox after a minute? Check spam, or go back and try again.</p>
            <button className="btn-ghost mx-auto" onClick={() => { setWaiting(null); setMode("in"); }}>Back to sign in</button>
          </div>
        ) : (
        <form onSubmit={submit} className="space-y-4 p-8">
          <div>
            <div className="label">Sundays | {APP_NAME[app]}</div>
            <h1 className="mt-1 text-xl font-semibold">{mode === "in" ? "Sign in" : "Create your account"}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {mode === "in" ? "Your Sundays account for Operations and AVL (separate from Planning Center)." : "Then start your organization, or join your team when an admin invites you."}
            </p>
          </div>
          {mode === "up" && (
            <label className="block"><span className="label mb-1.5 block">Your name</span>
              <input className="input" required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="First and last name" /></label>
          )}
          <label className="block"><span className="label mb-1.5 block">Email</span>
            <input className="input" type="email" required autoFocus={mode === "in"} autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="you@yourchurch.org" /></label>
          <label className="block"><span className="label mb-1.5 block">Password</span>
            <input className="input" type="password" required autoComplete={mode === "in" ? "current-password" : "new-password"} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
          {msg && <p className={clsx("rounded-lg px-3 py-2 text-sm", msg.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad")}>{msg.text}</p>}
          <button className="btn-primary w-full py-2.5" disabled={busy}>
            {busy ? <Spinner /> : mode === "in" ? <KeyRound size={15} /> : <UserPlus size={15} />}
            {mode === "in" ? "Sign in" : "Create account"}
          </button>
          <p className="text-center text-sm text-ink-muted">
            {mode === "in" ? <>New here? <button type="button" className="text-accent hover:underline" onClick={() => { setMode("up"); setMsg(null); }}>Create an account</button></>
              : <>Have an account? <button type="button" className="text-accent hover:underline" onClick={() => { setMode("in"); setMsg(null); }}>Sign in</button></>}
          </p>
          {STANDALONE && <p className="text-center text-xs"><Link href="/pricing" className="text-ink-muted hover:text-accent">See plans &amp; pricing</Link></p>}
        </form>
        )}
      </div>
    </div>
  );
}

function Waiting({ me, onCheck, checking }: { me: Extract<OpsMe, { status: "pending" | "inactive" }>; onCheck: () => void; checking: boolean }) {
  const qc = useQueryClient();
  return (
    <Center>
      <div className="panel max-w-md p-8 text-center">
        <div className={clsx("mx-auto grid h-12 w-12 place-items-center rounded-full", me.status === "pending" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad")}>
          {me.status === "pending" ? <Clock3 size={22} /> : <ShieldCheck size={22} />}
        </div>
        <h1 className="mt-4 text-lg font-semibold">{me.status === "pending" ? "Waiting for approval" : "Your account isn't active"}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {me.status === "pending"
            ? <>Thanks, {me.name.split(" ")[0]}. A manager{me.org.name ? ` at ${me.org.name}` : ""} needs to approve <b className="text-ink">{me.email}</b> and choose your campus and access. This page opens as soon as they do.</>
            : <>A manager turned off <b className="text-ink">{me.email}</b>. Ask them if you need access again.</>}
        </p>
        {me.orgs.length > 1 && <div className="mt-5 text-left"><div className="label mb-2">Switch to</div><OrgList me={me} /></div>}
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn-outline" onClick={onCheck} disabled={checking}><RefreshCw size={14} className={clsx(checking && "animate-spin")} /> Check again</button>
          <button className="btn-ghost" onClick={async () => { await opsSignOut(); await qc.invalidateQueries({ queryKey: ["ops"] }); }}><LogOut size={14} /> Sign out</button>
        </div>
      </div>
    </Center>
  );
}

/** Signed in, but not in any organization yet: start one, or wait for an invitation. */
function Welcome({ me }: { me: Extract<OpsMe, { status: "no-org" }> }) {
  const qc = useQueryClient();
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <div className="label">Welcome to Sundays</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Start your organization</h1>
          <p className="mt-1 text-sm text-ink-muted">Set up your church or ministry. You&apos;ll be its System admin and can invite your team from Settings → Users.</p>
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="panel p-5"><CreateOrgForm /></section>
          <aside className="space-y-4">
            <section className="panel p-4 text-sm">
              <div className="flex items-center gap-2 font-medium"><Mail size={15} className="text-accent" /> Joining your team?</div>
              <p className="mt-1 text-ink-muted">Ask an admin at your church to add <b className="text-ink">{me.email}</b> under Settings → Users. Then check again.</p>
              <button className="btn-outline mt-3 w-full justify-center" onClick={() => void qc.invalidateQueries({ queryKey: ["ops"] })}><RefreshCw size={14} /> Check again</button>
            </section>
            {me.orgs.length > 0 && <section className="panel p-4"><div className="label mb-2">Your organizations</div><OrgList me={me} /></section>}
            {me.platform && <Link href="/admin" className="panel flex items-center gap-2 p-4 text-sm font-medium hover:border-line-strong"><ShieldHalf size={15} className="text-accent" /> Open the admin console <ArrowRight size={14} className="ml-auto" /></Link>}
            <button className="btn-ghost w-full justify-center" onClick={async () => { await opsSignOut(); await qc.invalidateQueries({ queryKey: ["ops"] }); }}><LogOut size={14} /> Sign out</button>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Suspended({ me }: { me: Extract<OpsMe, { status: "suspended" }> }) {
  const qc = useQueryClient();
  return (
    <Center>
      <div className="panel max-w-md p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-bad-soft text-bad"><ShieldCheck size={22} /></div>
        <h1 className="mt-4 text-lg font-semibold">{me.org.name ?? "This organization"} is {me.org.status === "CANCELLED" ? "cancelled" : "paused"}</h1>
        <p className="mt-1 text-sm text-ink-muted">Its data is safe. Contact Sundays to turn it back on.</p>
        {me.orgs.length > 1 && <div className="mt-5 text-left"><div className="label mb-2">Switch to</div><OrgList me={me} /></div>}
        <button className="btn-ghost mt-4" onClick={async () => { await opsSignOut(); await qc.invalidateQueries({ queryKey: ["ops"] }); }}><LogOut size={14} /> Sign out</button>
      </div>
    </Center>
  );
}

/** The Sundays admin console: signed in as a super admin (no organization needed). */
export function AdminBody({ children }: { children: React.ReactNode }) {
  const { session } = useOpsSession();
  const me = useOpsMe(Boolean(session));
  if (session === undefined || (session && me.isLoading)) return <Center><Spinner size={18} /></Center>;
  if (!session || (me.error && (me.error as { status?: number }).status === 401)) return <div className="flex min-h-0 flex-1 flex-col"><SignIn app="ops" churchName={null} /></div>;
  if (me.error) return <Center><p className="max-w-sm text-center text-sm text-bad">{(me.error as Error).message}</p><Retry onClick={() => void me.refetch()} /></Center>;
  if (!me.data?.platform) {
    return <Center><div className="panel max-w-md p-8 text-center"><ShieldHalf size={22} className="mx-auto text-ink-muted" /><h1 className="mt-3 text-lg font-semibold">Super admins only</h1>
      <p className="mt-1 text-sm text-ink-muted">The Sundays admin console is for the people who run Sundays.</p><Link href="/ops" className="btn-outline mt-4 inline-flex">Back to Operations</Link></div></Center>;
  }
  return <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">{children}</div></div>;
}
