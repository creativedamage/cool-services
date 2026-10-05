"use client";
/**
 * Church Ops sign-in. Everyone has their own account (email + password, kept by Sundays' cloud).
 * New accounts wait until a manager approves them; the very first account is the System admin.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Building2, Clock3, KeyRound, LogOut, RefreshCw, ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import type { OpsMe } from "@shared/ops/types";
import { Api, qk } from "@/lib/api";
import { ops, opsSignOut, supabase, useOpsMe, useOpsSession } from "@/lib/ops";
import { Spinner } from "@/components/ui";

export function OpsGate({ children }: { children: (me: Extract<OpsMe, { status: "ok" }>) => React.ReactNode }) {
  const { session } = useOpsSession();
  const me = useOpsMe(Boolean(session));
  const qc = useQueryClient();
  const sundaysMe = useQuery({ queryKey: qk.me, queryFn: Api.me, staleTime: Infinity });

  // First time: the church's name from Planning Center (it's never typed into the code).
  const m = me.data;
  useEffect(() => {
    if (m?.status === "ok" && !m.org.name && sundaysMe.data?.orgName) {
      void ops("/bootstrap", { json: { orgName: sundaysMe.data.orgName } }).then(() => qc.invalidateQueries({ queryKey: ["ops"] })).catch(() => undefined);
    }
  }, [m, sundaysMe.data?.orgName, qc]);

  if (session === undefined || (session && me.isLoading)) return <Center><Spinner size={18} /></Center>;
  if (!session || (me.error && (me.error as { status?: number }).status === 401)) return <SignIn churchName={sundaysMe.data?.orgName ?? null} />;
  if (me.error) return <Center><p className="max-w-sm text-center text-sm text-bad">{(me.error as Error).message}</p><Retry onClick={() => void me.refetch()} /></Center>;
  if (!m) return null;
  if (m.status !== "ok") return <Waiting me={m} onCheck={() => void me.refetch()} checking={me.isFetching} />;
  return <>{children(m)}</>;
}

const Center = ({ children }: { children: React.ReactNode }) => <div className="grid flex-1 place-items-center p-8"><div className="flex flex-col items-center gap-3">{children}</div></div>;
const Retry = ({ onClick }: { onClick: () => void }) => <button className="btn-outline" onClick={onClick}><RefreshCw size={14} /> Try again</button>;

function SignIn({ churchName }: { churchName: string | null }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const sb = await supabase();
      if (mode === "in") {
        const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
        if (error) throw error;
        await qc.invalidateQueries({ queryKey: ["ops"] });
      } else {
        if (f.password.length < 8) throw new Error("Use at least 8 characters for your password.");
        const { data, error } = await sb.auth.signUp({ email: f.email.trim(), password: f.password, options: { data: { name: f.name.trim() } } });
        if (error) throw error;
        if (!data.session) {
          setMode("in");
          setMsg({ ok: true, text: "Check your email and click the link to confirm your address, then sign in here." });
        } else await qc.invalidateQueries({ queryKey: ["ops"] });
      }
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div className="grid flex-1 place-items-center overflow-y-auto p-8">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface shadow-lift md:grid-cols-[1.1fr_1fr]">
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-accent/25 via-violet/15 to-transparent p-8 md:flex">
          <div>
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-on-accent"><Building2 size={22} /></div>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight">Church Ops</h2>
            <p className="mt-1 text-sm text-ink-soft">{churchName ? `${churchName}'s` : "Your church's"} requests, facilities and AVL quoting, right inside Sundays.</p>
          </div>
          <ul className="space-y-3 text-sm text-ink-soft">
            {[
              ["Ask for anything", "Technology, supplies and building repairs, routed to the right team at your campus."],
              ["Work the queue", "Approve, assign, start, hold and finish, with every step on the record."],
              ["Quote AVL projects", "Vendor price lists, margins and proposals your customers can print."],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /><span><b className="text-ink">{t}.</b> {d}</span></li>
            ))}
          </ul>
        </div>
        <form onSubmit={submit} className="space-y-4 p-8">
          <div>
            <div className="label">Church Ops</div>
            <h1 className="mt-1 text-xl font-semibold">{mode === "in" ? "Sign in" : "Create your account"}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {mode === "in" ? "Your Church Ops account (separate from Planning Center)." : "A manager approves new accounts and sets what you can do."}
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
        </form>
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
            ? <>Thanks, {me.name.split(" ")[0]}. A manager{me.org.name ? ` at ${me.org.name}` : ""} needs to approve <b className="text-ink">{me.email}</b> and choose your campus and access. This page opens Church Ops as soon as they do.</>
            : <>A manager turned off <b className="text-ink">{me.email}</b>. Ask them if you need access again.</>}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn-outline" onClick={onCheck} disabled={checking}><RefreshCw size={14} className={clsx(checking && "animate-spin")} /> Check again</button>
          <button className="btn-ghost" onClick={async () => { await opsSignOut(); await qc.invalidateQueries({ queryKey: ["ops"] }); }}><LogOut size={14} /> Sign out</button>
        </div>
      </div>
    </Center>
  );
}
