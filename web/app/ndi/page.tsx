"use client";
/**
 * The picture sent over NDI: the next service's stage plot, full frame, with names filled in.
 * Rendered by the Mac app in an invisible window; also shown as the preview in Settings.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Api, planQuery, qk } from "@/lib/api";
import { peopleForPlan } from "@/lib/stage";
import { PlotCanvas } from "@/components/stage/PlotCanvas";

export default function NdiPage() {
  const settings = useQuery({ queryKey: qk.settings, queryFn: Api.settings, refetchInterval: 10_000 });
  const ndi = settings.data?.ndi;
  // Re-check which service is "next" every few minutes so it rolls over after Sunday.
  const plans = useQuery({ queryKey: qk.plans, queryFn: () => Api.plans(), refetchInterval: 300_000 });
  const next = (plans.data ?? []).find((p) => !ndi?.serviceTypeId || p.serviceTypeId === ndi.serviceTypeId);
  const plan = useQuery({ ...planQuery(next?.serviceTypeId ?? "", next?.id ?? ""), enabled: Boolean(next), refetchInterval: 30_000 });
  const plots = useQuery({ queryKey: qk.plots, queryFn: Api.plots, refetchInterval: 15_000 });
  const choice = useQuery({ queryKey: qk.planPlot(next?.id ?? ""), queryFn: () => Api.planPlot(next!.id), enabled: Boolean(next), refetchInterval: 15_000 });
  const mics = useQuery({ queryKey: qk.planMics(next?.id ?? ""), queryFn: () => Api.planMics(next!.id), enabled: Boolean(next), refetchInterval: 10_000 });
  const micSetup = useQuery({ queryKey: qk.micSetup, queryFn: Api.micSetup, refetchInterval: 60_000 });
  const [vh, setVh] = useState(1080);
  useEffect(() => { const f = () => setVh(window.innerHeight); f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);

  const white = ndi?.background === "white";
  const list = plots.data ?? [];
  const plot = list.find((p) => p.id === choice.data?.plotId) ?? list.find((p) => p.serviceTypeId === next?.serviceTypeId) ?? null;
  const people = plot ? peopleForPlan(plot.items, plan.data, mics.data?.assignments, micSetup.data?.channels) : new Map();
  const micLabels = new Map((micSetup.data?.channels ?? []).map((c) => [c.id, c.label]));
  const header = ndi?.showHeader ?? true;
  const headerPx = header ? Math.round(vh * 0.085) : 0;
  const pad = Math.round(vh * 0.025);

  const message = settings.error || plans.error ? "Open Cool Services and sign in"
    : !plans.data ? "" : !next ? "No upcoming services" : !plot ? `No stage plot for ${next.serviceTypeName}` : null;

  return (
    <div data-theme={white ? "light" : "dark"} style={{ background: white ? "#fff" : "#000", color: white ? "#000" : "#fff", height: "100vh", padding: pad, overflow: "hidden" }}>
      {header && next && (
        <div style={{ height: headerPx, fontSize: headerPx * 0.42 }} className="flex items-center justify-between font-semibold">
          <span className="truncate">{next.title}</span>
          <span className="opacity-70" style={{ fontSize: headerPx * 0.32 }}>
            {new Date(next.sortDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </span>
        </div>
      )}
      {message !== null ? (
        <div className="grid h-full place-items-center opacity-60" style={{ fontSize: vh * 0.03 }}>{message}</div>
      ) : plot && (
        <PlotCanvas plot={plot} people={people} micLabels={micLabels} fitHeight={headerPx + pad * 2 + 2} />
      )}
    </div>
  );
}
