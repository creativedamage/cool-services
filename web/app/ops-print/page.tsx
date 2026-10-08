"use client";
/** Quote print preview: exactly what the customer gets (no cost, margin or internal notes). Print → Save as PDF. */
import { ArrowLeft, Printer } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { PrintData } from "@shared/ops/types";
import { useOps } from "@/lib/ops";
import { ProposalDoc } from "@/components/avl/ProposalDoc";
import { Spinner } from "@/components/ui";

export default function Page() { return <Suspense><Print /></Suspense>; }

function Print() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const d = useOps<PrintData>(id ? `/quotes/${id}/print` : null);
  return (
    <div className="min-h-screen overflow-y-auto bg-[#e9ebef] py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[8.5in] justify-between gap-2 px-4">
        <button className="btn-outline bg-white text-[#333]" onClick={() => router.back()}><ArrowLeft size={14} /> Back to the quote</button>
        <button className="btn-primary" onClick={() => window.print()}><Printer size={14} /> Print or save as PDF</button>
      </div>
      {!d.data ? (
        <div className="grid place-items-center py-20 text-[#555]">{d.error ? (d.error as Error).message : <Spinner size={18} />}</div>
      ) : (
        <div className="ops-proposal mx-auto max-w-[8.5in] bg-white p-10 text-[#111] shadow-lg print:max-w-none print:p-0 print:shadow-none">
          <ProposalDoc data={d.data} />
        </div>
      )}
    </div>
  );
}
