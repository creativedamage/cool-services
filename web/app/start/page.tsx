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
        const s = await Api.settings();
        const v = s.startView;
        if (v.kind === "workflow") return router.replace(routes.board(v.workflowId));
        if (v.kind === "services") return router.replace("/services");
        if (v.kind === "next-service" || v.kind === "next-checkins") {
          const plans = (await Api.plans()).filter((p) => !v.serviceTypeId || p.serviceTypeId === v.serviceTypeId);
          const next = plans[0];
          if (!next) return router.replace("/services");
          return router.replace(v.kind === "next-service" ? routes.plan(next.serviceTypeId, next.id) : routes.checkins(next.serviceTypeId, next.id));
        }
      } catch { /* fall through */ }
      router.replace("/workflows");
    })();
  }, [router]);
  return <div className="grid min-h-screen place-items-center"><div className="animate-pulse"><Logo size={48} /></div></div>;
}
