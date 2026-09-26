"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PlotEditor } from "@/components/stage/PlotEditor";

function Page() {
  const id = useSearchParams().get("id");
  return id ? <PlotEditor key={id} plotId={id} /> : null;
}
export default function EditPlotPage() { return <Suspense><Page /></Suspense>; }
