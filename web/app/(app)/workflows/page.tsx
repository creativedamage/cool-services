"use client";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Api, qk } from "@/lib/api";
import { Skeleton } from "@/components/ui";
import { routes } from "@/lib/routes";

export default function WorkflowsIndex() {
  const { data, isLoading } = useQuery({ queryKey: qk.workflows, queryFn: Api.workflows });
  return (
    <div className="overflow-y-auto p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
      <p className="mt-1 text-sm text-ink-muted">Pick a Planning Center People workflow to open it as a board.</p>
      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}
        {data?.map((w) => (
          <Link key={w.id} href={routes.board(w.id)}
            className="panel group p-4 transition hover:border-line-strong hover:bg-raised">
            <div className="flex items-start justify-between">
              <div className="font-medium">{w.name}</div>
              <ArrowUpRight size={16} className="text-ink-faint transition group-hover:text-accent" />
            </div>
            <div className="mt-5 flex items-end gap-4">
              <div>
                <div className="text-2xl font-semibold tabular-nums">{w.readyCount}</div>
                <div className="text-xs text-ink-muted">ready cards</div>
              </div>
              {w.overdueCount > 0 && (
                <div className="mb-0.5 flex items-center gap-1 text-xs text-bad">
                  <AlertCircle size={13} /> {w.overdueCount} overdue
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
