"use client";
/** The stage plot for one service, with names filled in from that Sunday's mics and positions. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Printer } from "lucide-react";
import Link from "next/link";
import { Api, planQuery, qk } from "@/lib/api";
import { routes } from "@/lib/routes";
import { peopleForPlan } from "@/lib/stage";
import { PlotCanvas } from "./PlotCanvas";
import { PlanHeader } from "@/components/services/PlanTabs";
import { Skeleton } from "@/components/ui";

export function PlanStage({ serviceTypeId, planId }: { serviceTypeId: string; planId: string }) {
  const qc = useQueryClient();
  const plan = useQuery(planQuery(serviceTypeId, planId));
  const plots = useQuery({ queryKey: qk.plots, queryFn: Api.plots });
  const choice = useQuery({ queryKey: qk.planPlot(planId), queryFn: () => Api.planPlot(planId) });
  const mics = useQuery({ queryKey: qk.planMics(planId), queryFn: () => Api.planMics(planId) });
  const micSetup = useQuery({ queryKey: qk.micSetup, queryFn: Api.micSetup, staleTime: Infinity });
  const choose = useMutation({
    mutationFn: (plotId: string | null) => Api.setPlanPlot(planId, plotId),
    onSuccess: (r) => qc.setQueryData(qk.planPlot(planId), r),
  });

  const list = plots.data ?? [];
  const plot = list.find((p) => p.id === choice.data?.plotId)
    ?? list.find((p) => p.serviceTypeId === serviceTypeId)
    ?? null;
  const people = plot ? peopleForPlan(plot.items, plan.data, mics.data?.assignments, micSetup.data?.channels) : new Map();
  const micLabels = new Map((micSetup.data?.channels ?? []).map((c) => [c.id, c.label]));
  const p = plan.data;

  return (
    <div className="h-full overflow-y-auto">
      <PlanHeader st={serviceTypeId} plan={planId} active="stage" title={p?.title} date={p?.sortDate} typeName={p?.serviceTypeName}
        right={list.length > 0 && (
          <div className="flex items-center gap-2">
            <select className="input w-60 py-1.5 text-xs" value={plot?.id ?? ""} onChange={(e) => choose.mutate(e.target.value || null)}>
              {!plot && <option value="">Choose a stage plot…</option>}
              {list.map((x) => <option key={x.id} value={x.id}>{x.name}{x.serviceTypeId === serviceTypeId ? " (default)" : ""}</option>)}
            </select>
            {plot && <Link href={routes.stagePlot(plot.id)} className="btn-outline py-1.5 text-xs"><Pencil size={13} /> Edit</Link>}
            {plot && <button className="btn-outline py-1.5 text-xs" onClick={() => window.print()}><Printer size={13} /> Print</button>}
          </div>
        )} />
      <div className="p-6">
        {plots.isLoading || choice.isLoading ? <Skeleton className="h-96" /> : !plot ? (
          <div className="panel mx-auto max-w-lg p-6 text-center">
            <h2 className="font-semibold">No stage plot yet</h2>
            <p className="mt-1 text-sm text-ink-muted">Make a stage plot (on a blank stage or on your own PDF) and set it as the default for this service type.</p>
            <Link href="/stage-plots" className="btn-primary mt-4"><Plus size={14} /> Stage plots</Link>
          </div>
        ) : (
          <div className="print-area mx-auto max-w-6xl">
            <div className="mb-3 hidden print:block">
              <div className="text-lg font-semibold">{p?.title} · {p && new Date(p.sortDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
              <div className="text-sm">{plot.name}</div>
            </div>
            <PlotCanvas plot={plot} people={people} micLabels={micLabels} fitHeight={230} />
            <p className="no-print mt-2 text-center text-[11px] text-ink-faint">Names come from this service’s mic assignments and team. Set what each item shows in the plot editor.</p>
          </div>
        )}
      </div>
    </div>
  );
}
