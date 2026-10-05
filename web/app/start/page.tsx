"use client";
/** Sends you to the start-up view chosen in Settings (after signing in or opening the app). */
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Api } from "@/lib/api";
import { routes } from "@/lib/routes";
import { pickWeekendService } from "@/lib/weekend";
import { lastApp } from "@/components/AppSwitcher";
import { Logo } from "@/components/Logo";

export default function StartPage() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      try {
        // First time on this Mac: Full Mode, Service Mode or FOH Companion?
        const { mode } = await Api.appMode().catch(() => ({ mode: "full" as const }));
        if (mode === null) return router.replace("/setup-mode");
        if (mode === "companion") return router.replace("/companion");
        // Church Ops was open last: back to it (Full Mode only).
        if (mode === "full" && lastApp() === "ops") return router.replace("/ops");
        const s = await Api.settings();
        let v = s.startView;
        // Service Mode opens only what it keeps (Services by default).
        if (mode === "service" && !["services", "propresenter", "paging", "next-service", "next-runsheet"].includes(v.kind)) v = { kind: "services" };
        if (v.kind === "workflow") return router.replace(routes.board(v.workflowId));
        if (v.kind === "services") return router.replace("/services");
        if (v.kind === "dashboard") return router.replace("/dashboard");
        if (v.kind === "propresenter") return router.replace("/propresenter");
        if (v.kind === "paging") return router.replace("/paging");
        if (v.kind === "next-service" || v.kind === "next-checkins" || v.kind === "next-runsheet") {
          // The picked weekend's service (no type chosen: "Your service" from the dashboard, if set).
          const st = v.serviceTypeId ?? (await Api.home().catch(() => null))?.serviceTypeId ?? null;
          const next = pickWeekendService(await Api.weekend(), st);
          if (!next) return router.replace("/services");
          return router.replace(v.kind === "next-service" ? routes.plan(next.serviceTypeId, next.id)
            : v.kind === "next-runsheet" ? routes.runSheet(next.serviceTypeId, next.id) : routes.checkins(next.serviceTypeId, next.id));
        }
      } catch { /* fall through */ }
      router.replace("/workflows");
    })();
  }, [router]);
  return <div className="grid min-h-screen place-items-center"><div className="animate-pulse"><Logo size={48} /></div></div>;
}
