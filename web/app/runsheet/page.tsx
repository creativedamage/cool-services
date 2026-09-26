"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FullRunSheet } from "@/components/runsheet/FullRunSheet";

/** /runsheet?st=<service type>&plan=<plan>: the whole-page run sheet (no sidebar). */
function Page() {
  const q = useSearchParams();
  const st = q.get("st"), plan = q.get("plan");
  return st && plan ? <FullRunSheet key={plan} serviceTypeId={st} planId={plan} kioskStart={q.has("k")} /> : null;
}
export default function RunSheetPage() { return <Suspense><Page /></Suspense>; }
