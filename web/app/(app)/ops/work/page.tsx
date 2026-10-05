"use client";
/** Work queue: requests routed to your teams (or your campus, if you're a manager). */
import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { KIND_LABEL, type RequestKind } from "@shared/ops/workflow";
import type { RequestRow } from "@shared/ops/types";
import { useOps } from "@/lib/ops";
import { Card, ErrorBox, Loading, PageHeader, Tabs } from "@/components/ops/OpsUi";
import { RequestTable } from "@/components/ops/RequestTable";

type Tab = "open" | "approval" | "mine" | "done";
export default function Page() { return <Suspense><Work /></Suspense>; }

function Work() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = (sp.get("tab") as Tab) || "open";
  const kind = sp.get("kind") || "";
  const campus = sp.get("campus") || "";
  const q = new URLSearchParams({ tab, ...(kind ? { kind } : {}), ...(campus ? { campus } : {}) });
  const d = useOps<{ rows: RequestRow[]; counts: Record<Tab, number | null>; campuses: { id: string; name: string }[]; description: string }>(`/work?${q}`, { refetchInterval: 30_000 });
  const go = (p: Record<string, string>) => {
    const n = new URLSearchParams({ tab, kind, campus, ...p });
    for (const [k, v] of [...n.entries()]) if (!v) n.delete(k);
    router.replace(`/ops/work?${n}`);
  };
  return (
    <>
      <PageHeader crumb="Requests" title="Work queue" description={d.data?.description} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs<Tab> value={tab} onChange={(t) => go({ tab: t })} items={[
          { key: "open", label: "Open", count: d.data?.counts.open }, { key: "approval", label: "Needs approval", count: d.data?.counts.approval },
          { key: "mine", label: "Assigned to me", count: d.data?.counts.mine }, { key: "done", label: "Completed" },
        ]} />
        <div className="ml-auto flex flex-wrap items-center gap-1 text-xs">
          {[["", "All types"], ...(["TECHNOLOGY", "SUPPLY", "MAINTENANCE"] as RequestKind[]).map((k) => [k, KIND_LABEL[k]])].map(([k, l]) => (
            <button key={k} onClick={() => go({ kind: k })} className={clsx("rounded-md px-2.5 py-1.5", kind === k ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-hover")}>{l}</button>
          ))}
          {(d.data?.campuses.length ?? 0) > 1 && (
            <select className="input ml-2 w-auto py-1 text-xs" value={campus} onChange={(e) => go({ campus: e.target.value })}>
              <option value="">All campuses</option>
              {d.data!.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      </div>
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : <Card><RequestTable rows={d.data.rows} show={{ requester: true, campus: true, assignee: true }} empty="Nothing here. Nice work." /></Card>}
    </>
  );
}
