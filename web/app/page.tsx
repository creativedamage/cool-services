"use client";
import { CalendarCheck, KanbanSquare, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { PlanningCenterButton } from "@/components/PlanningCenterButton";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

interface Status { signInAvailable: boolean; allowDemo: boolean }

function Login() {
  const params = useSearchParams();
  const error = params.get("error");
  const back = params.get("return");
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/auth/status").then((r) => r.json()).then(setStatus).catch(() => {});
    // An FOH companion doesn't sign in: straight to its screen.
    fetch("/api/app-mode").then((r) => r.json()).then((m) => { if (m.mode === "companion") router.replace("/companion"); }).catch(() => {});
    // Already signed in? Skip straight in (not after being signed out: that would bounce back and forth).
    if (!error) fetch("/api/auth/me").then((r) => r.ok && router.replace("/start")).catch(() => {});
  }, [router, error]);

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-4">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />
      <div className="relative w-full max-w-[420px]">
        <div className="mb-8 flex items-center gap-3">
          <Logo />
          <div>
            <div className="text-lg font-semibold tracking-tight">Cool Services</div>
            <div className="text-sm text-ink-muted">for Planning Center</div>
          </div>
        </div>

        <div className="panel p-6 shadow-2xl">
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-muted">Sign in with your Planning Center account. Your workflows, people and services sync automatically.</p>

          {error && (
            <div className="mt-4 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
              {error === "not_in_church"
                ? "That Planning Center account isn’t part of this church’s organization."
                : error === "sign_in_not_available"
                ? "Sign-in isn’t switched on for this site yet. Please let the site administrator know."
                : error === "access_denied"
                  ? "Planning Center sign-in was cancelled. Click the button to try again."
                : error === "signed_out"
                  ? "Planning Center signed you out (this happens now and then). Sign in again and you’ll be right back where you were."
                  : "Sign-in didn’t complete. Please try again."}
            </div>
          )}

          <PlanningCenterButton href={back && back.startsWith("/") && !back.startsWith("//") ? `/api/auth/login?return=${encodeURIComponent(back)}` : undefined} />
          <p className="mt-2.5 text-center text-xs text-ink-muted">Use the same email and password you use for Planning Center.</p>
          <a href="/setup-mode" className="mt-3 block text-center text-[11px] text-ink-faint hover:text-warn">Setting up the front-of-house computer? Use it as an FOH companion →</a>

          {status && !status.signInAvailable && (
            <p className="mt-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
              Sign-in isn’t switched on for this site yet. Please let the site administrator know.
            </p>
          )}

          {status?.allowDemo && (
            <a href="/api/auth/demo" className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-muted transition hover:text-violet">
              <Sparkles size={12} /> Or explore with sample data
            </a>
          )}

          <ul className="mt-6 space-y-2.5 border-t border-line pt-5 text-sm text-ink-soft">
            <li className="flex items-center gap-2.5"><KanbanSquare size={16} className="text-accent" /> People workflows as a drag-and-drop board</li>
            <li className="flex items-center gap-2.5"><CalendarCheck size={16} className="text-ok" /> Schedule teams in three clicks, conflicts flagged</li>
            <li className="flex items-center gap-2.5"><ShieldCheck size={16} className="text-violet" /> Secure sign-in with your Planning Center account</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
