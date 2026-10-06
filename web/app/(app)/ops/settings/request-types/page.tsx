"use client";
/** What staff can ask for, how each type flows, and which team handles it at each campus. */
import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KIND_LABEL, type RequestKind } from "@shared/ops/workflow";
import type { CategoryRow } from "@shared/ops/types";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Loading, PageHeader, Pill, Table } from "@/components/ops/OpsUi";
import { CategoryFields, emptyCategory, type CategoryForm } from "@/components/ops/CategoryFields";
import { TypeIcon } from "@/components/ops/TypeIcon";
import { useOpsUser } from "@/components/ops/context";
import { kindAllowed } from "@shared/ops/billing";

const WF = { APPROVAL: "Approval", FULFILLMENT: "Fulfillment", WORK_ORDER: "Work order" } as const;

export default function RequestTypes() {
  const d = useOps<{ categories: CategoryRow[]; campusCount: number; global: boolean }>("/settings/request-types");
  const [adding, setAdding] = useState(false);
  // "Add a request type" from the New request page lands here with ?add=1.
  useEffect(() => { if (new URLSearchParams(window.location.search).has("add")) setAdding(true); }, []);
  const kinds = [...new Set((d.data?.categories ?? []).map((c) => c.kind))] as RequestKind[];
  return (
    <>
      <PageHeader crumb="Settings" title="Request types" description={d.data?.global ? "What staff can request, how each type flows, and which team handles it at each campus." : "Choose which team handles each request type at your campus."}
        actions={d.data?.global && <button className="btn-primary" onClick={() => setAdding(true)} disabled={adding}><Plus size={15} /> Add request type</button>} />
      {adding && d.data?.global && <NewType onClose={() => setAdding(false)} />}
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
                      <td><span className="flex items-center gap-3"><TypeIcon icon={c.icon} kind={c.kind} className="h-8 w-8" size={15} /><span className="min-w-0"><span className="flex items-center gap-2 font-medium">{c.name}{!c.active && <Pill tone="muted">inactive</Pill>}</span>{c.description && <span className="block truncate text-xs text-ink-muted">{c.description}</span>}</span></span></td>
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

function NewType({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const modules = useOpsUser().nav.modules;
  const [f, setF] = useState<CategoryForm>(() => {
    const kind = (["MAINTENANCE", "TECHNOLOGY", "SUPPLY", "OTHER"] as const).find((k) => kindAllowed(k, modules)) ?? "OTHER";
    return { ...emptyCategory(), kind, workflow: kind === "MAINTENANCE" || kind === "OTHER" ? "WORK_ORDER" as const : "APPROVAL" as const };
  });
  return (
    <Card eyebrow="Add" title="New request type" className="mb-5" action={<button className="btn-ghost" onClick={onClose} aria-label="Close"><X size={15} /></button>}>
      <form className="p-4" onSubmit={async (e) => {
        e.preventDefault();
        try { const r = await ops<{ id: string }>("/settings/request-types", { json: f }); await refresh(); router.push(`/ops/settings/request-types/view?id=${r.id}`); }
        catch (err) { toast.error((err as Error).message); }
      }}>
        <CategoryFields f={f} set={setF} />
        <div className="mt-6 flex gap-2"><button className="btn-primary" disabled={!f.name.trim()}><Plus size={15} /> Add request type</button><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Card>
  );
}
