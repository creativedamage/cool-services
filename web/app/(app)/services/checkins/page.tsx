"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CheckInsView } from "@/components/services/CheckInsView";

function Page() {
  const q = useSearchParams();
  const st = q.get("st"), plan = q.get("plan");
  return st && plan ? <CheckInsView key={plan} serviceTypeId={st} planId={plan} /> : null;
}
export default function CheckInsPage() { return <Suspense><Page /></Suspense>; }
