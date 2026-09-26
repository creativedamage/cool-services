"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { MatrixView } from "@/components/services/MatrixView";

/** /services/matrix?st=<service type> */
function Page() {
  const st = useSearchParams().get("st");
  return st ? <MatrixView key={st} serviceTypeId={st} /> : null;
}
export default function MatrixPage() { return <Suspense><Page /></Suspense>; }
