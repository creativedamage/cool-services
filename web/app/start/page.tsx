"use client";
/** Sends you to the start-up view chosen in Settings (after signing in or opening the app). */
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Api } from "@/lib/api";
import { routes } from "@/lib/routes";
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
          // No type chosen: "Your service" from the dashboard, if one is set.
          const st = v.serviceTypeId ?? (await Api.home().catch(() => null))?.serviceTypeId ?? null;
          const cutoff = Date.now() - 6 * 3600e3;
          const next = (await Api.plans()).filter((p) => (!st || p.serviceTypeId === st) && Date.parse(p.sortDate) > cutoff)[0];
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
