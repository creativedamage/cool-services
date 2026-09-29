"use client";
/** First time on this Mac: run the full Cool Services, or be an FOH companion for page requests. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BellRing, LayoutDashboard } from "lucide-react";
import { Api } from "@/lib/api";
import { Logo } from "@/components/Logo";

export default function SetupModePage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const choose = async (mode: "full" | "companion") => {
    setBusy(true);
    await Api.setAppMode(mode).catch(() => {});
    router.replace(mode === "companion" ? "/companion" : "/start");
  };
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6">
      <div className="w-full max-w-3xl">
        <div className="mb-8 flex items-center gap-3"><Logo size={36} /><div className="text-xl font-semibold">How will this Mac use Cool Services?</div></div>
        <div className="grid gap-4 md:grid-cols-2">
          <button disabled={busy} onClick={() => choose("full")} className="panel p-6 text-left transition hover:border-accent/60 disabled:opacity-50">
            <LayoutDashboard className="text-accent" size={28} />
            <div className="mt-3 text-lg font-semibold">Full Cool Services</div>
            <p className="mt-1 text-sm text-ink-muted">Workflows, services, run sheets, dashboard, paging and everything else, with your Planning Center sign-in.</p>
          </button>
          <button disabled={busy} onClick={() => choose("companion")} className="panel p-6 text-left transition hover:border-warn/60 disabled:opacity-50">
            <BellRing className="text-warn" size={28} />
            <div className="mt-3 text-lg font-semibold">FOH companion</div>
            <p className="mt-1 text-sm text-ink-muted">For the front-of-house computer. Links to your main Cool Services computer and takes over the screen when Kids or Nursery ask for a page, with big Accept, Hold and Deny buttons for a touch screen. Children’s names are never shown.</p>
          </button>
        </div>
        <p className="mt-4 text-xs text-ink-faint">You can change this later in Preferences → Default Startup (full app) or from the companion screen’s ⚙.</p>
      </div>
    </main>
  );
}
