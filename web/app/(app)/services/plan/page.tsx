"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ServiceView } from "@/components/services/ServiceView";

/** /services/plan?st=<service type>&plan=<plan id> */
function Plan() {
  const q = useSearchParams();
  const st = q.get("st"), plan = q.get("plan");
  return st && plan ? <ServiceView key={plan} serviceTypeId={st} planId={plan} /> : null;
}

export default function PlanPage() {
  return <Suspense><Plan /></Suspense>;
}
