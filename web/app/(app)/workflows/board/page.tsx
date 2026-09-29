"use client";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Api, qk } from "@/lib/api";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { LockedWorkflow } from "@/components/workflows/WorkflowAccess";

/** /workflows/board?id=<workflow id> — query params so the UI can be a static export in the Mac app. */
function Board() {
  const id = useSearchParams().get("id");
  const workflows = useQuery({ queryKey: qk.workflows, queryFn: Api.workflows });
  const w = workflows.data?.find((x) => x.id === id);
  if (!id) return null;
  if (w && !w.canOpen) return <LockedWorkflow workflow={w} />;
  return <KanbanBoard key={id} workflowId={id} canShare={Boolean(w?.canManage)} />;
}

export default function WorkflowBoardPage() {
  return <Suspense><Board /></Suspense>;
}
