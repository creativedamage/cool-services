"use client";
/** What staff can ask for, how each type flows, and which team handles it at each campus. */
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { KIND_LABEL, type RequestKind } from "@shared/ops/workflow";
import type { CategoryRow } from "@shared/ops/types";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Loading, PageHeader, Pill, Table } from "@/components/ops/OpsUi";
import { CategoryFields, emptyCategory } from "@/components/ops/CategoryFields";

const WF = { APPROVAL: "Approval", FULFILLMENT: "Fulfillment", WORK_ORDER: "Work order" } as const;

export default function RequestTypes() {
  const d = useOps<{ categories: CategoryRow[]; campusCount: number; global: boolean }>("/settings/request-types");
  const [adding, setAdding] = useState(false);
  const kinds = [...new Set((d.data?.categories ?? []).map((c) => c.kind))] as RequestKind[];
  return (
    <>
      <PageHeader crumb="Settings" title="Request types" description={d.data?.global ? "What staff can request, how each type flows, and which team handles it at each campus." : "Choose which team handles each request type at your campus."}
        actions={d.data?.global && <button className="btn-primary" onClick={() => setAdding(!adding)}><Plus size={15} /> Add request type</button>} />
      {adding && <NewType />}
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <div className="space-y-5">
          {kinds.map((k) => (
            <Card key={k} eyebrow="Kind" title={KIND_LABEL[k]}>
              <Table min={700} head={<tr><th>Type</th><th>Workflow</th><th>Routing</th><th className="text-right">Requests</th><th /></tr>}>
                {d.data!.categories.filter((c) => c.kind === k).map((c) => {
                  const fallback = c.routing.find((r) => !r.campusId);
                  const specific = c.routing.filter((r) => r.campusId).length;
                  const unrouted = !fallback && specific < d.data!.campusCount;
                  return (
                    <tr key={c.id}>
                      <td><span className="mr-2">{c.icon}</span><span className="font-medium">{c.name}</span>{!c.active && <Pill tone="muted">inactive</Pill>}</td>
                      <td className="text-ink-soft">{WF[c.workflow]}{c.allowLineItems && ` · ${c.supplyItemCount} items`}</td>
                      <td className="text-xs">{unrouted ? <span className="text-warn">Not routed at every campus</span> : <span className="text-ink-soft">{fallback?.handlerTeam ?? ""}{specific ? `${fallback ? " + " : ""}${specific} campus route${specific === 1 ? "" : "s"}` : ""}</span>}</td>
                      <td className="text-right font-mono text-ink-soft">{c.requestCount}</td>
                      <td className="text-right"><Link href={`/ops/settings/request-types/view?id=${c.id}`} className="text-xs text-accent hover:underline">Configure →</Link></td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function NewType() {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const [f, setF] = useState(emptyCategory());
  return (
    <Card title="New request type" className="mb-5">
      <form className="grid gap-4 p-4 md:grid-cols-4" onSubmit={async (e) => {
        e.preventDefault();
        try { const r = await ops<{ id: string }>("/settings/request-types", { json: f }); await refresh(); router.push(`/ops/settings/request-types/view?id=${r.id}`); }
        catch (err) { toast.error((err as Error).message); }
      }}>
        <CategoryFields f={f} set={setF} />
        <div className="col-span-full"><button className="btn-primary">Create</button></div>
      </form>
    </Card>
  );
}
