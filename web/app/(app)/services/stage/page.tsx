"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PlanStage } from "@/components/stage/PlanStage";

function Page() {
  const q = useSearchParams();
  const st = q.get("st"), plan = q.get("plan");
  return st && plan ? <PlanStage key={plan} serviceTypeId={st} planId={plan} /> : null;
}
export default function PlanStagePage() { return <Suspense><Page /></Suspense>; }
