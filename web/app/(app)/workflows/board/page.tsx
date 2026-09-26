"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";

/** /workflows/board?id=<workflow id> — query params so the UI can be a static export in the Mac app. */
function Board() {
  const id = useSearchParams().get("id");
  return id ? <KanbanBoard key={id} workflowId={id} /> : null;
}

export default function WorkflowBoardPage() {
  return <Suspense><Board /></Suspense>;
}
