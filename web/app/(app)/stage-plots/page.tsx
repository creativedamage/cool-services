"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Api, qk } from "@/lib/api";
import { usePlans } from "@/lib/plans";
import { routes } from "@/lib/routes";
import { PlotCanvas } from "@/components/stage/PlotCanvas";
import { Skeleton } from "@/components/ui";

export default function StagePlotsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const plots = useQuery({ queryKey: qk.plots, queryFn: Api.plots });
  const plans = usePlans();
  const typeName = (id: string | null) => (plans.data ?? []).find((p) => p.serviceTypeId === id)?.serviceTypeName;

  const create = useMutation({
    mutationFn: Api.createPlot,
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: qk.plots }); router.push(routes.stagePlot(p.id)); },
  });
  const remove = useMutation({
    mutationFn: Api.deletePlot,
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.plots }); toast("Stage plot deleted"); },
  });

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stage plots</h1>
          <p className="mt-1 text-sm text-ink-muted">Build plots on a blank stage or on top of a PDF. Link items to mics or positions and each Sunday’s plot fills in who’s where.</p>
        </div>
        <button className="btn-primary" onClick={() => create.mutate({ name: "New stage plot" })}><Plus size={15} /> New stage plot</button>
      </div>
      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {plots.isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-56" />)}
        {plots.data?.length === 0 && <div className="text-sm text-ink-muted">No stage plots yet.</div>}
        {plots.data?.sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
          <div key={p.id} className="panel group overflow-hidden">
            <Link href={routes.stagePlot(p.id)} className="block p-3 pb-0">
              <div className="pointer-events-none"><PlotCanvas plot={p} className="rounded-lg" /></div>
            </Link>
            <div className="flex items-center gap-2 p-3">
              <Link href={routes.stagePlot(p.id)} className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="text-[11px] text-ink-muted">{p.items.length} items{p.serviceTypeId ? ` · default for ${typeName(p.serviceTypeId) ?? "a service type"}` : ""}</div>
              </Link>
              <button className="btn-ghost p-1.5" title="Duplicate"
                onClick={() => create.mutate({ name: `${p.name} copy`, items: p.items, background: p.background, serviceTypeId: null })}><Copy size={14} /></button>
              <button className="btn-ghost p-1.5" title="Delete"
                onClick={() => { if (confirm(`Delete “${p.name}”?`)) remove.mutate(p.id); }}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
