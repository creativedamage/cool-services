"use client";
import { useDroppable } from "@dnd-kit/core";
import clsx from "clsx";
import { CheckCircle2 } from "lucide-react";
import type { WorkflowCard } from "@shared/types";
import { PersonCard } from "./PersonCard";

export const DONE_ID = "__complete__";

export function KanbanColumn({ id, title, index, cards, pending, done }: {
  id: string; title: string; index?: number; cards: WorkflowCard[]; pending: Set<string>; done?: boolean;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id });
  const overdue = cards.filter((c) => c.overdue).length;

  if (done) {
    return (
      <section ref={setNodeRef}
        className={clsx("flex w-[160px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center transition",
          isOver ? "border-ok bg-ok-soft text-ok" : active ? "border-ok/40 text-ink-soft" : "border-line text-ink-faint")}>
        <CheckCircle2 size={22} />
        <div className="text-sm font-medium">{title}</div>
        <div className="px-4 text-[11px] leading-snug opacity-80">Drop here to finish the workflow</div>
      </section>
    );
  }

  return (
    <section ref={setNodeRef}
      className={clsx("flex w-[300px] shrink-0 flex-col rounded-xl border bg-surface transition-colors",
        isOver ? "border-accent/50 bg-accent/[0.04]" : "border-line")}>
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="grid h-5 w-5 place-items-center rounded-md bg-hover text-[10px] font-semibold text-ink-muted">{index}</span>
        <h2 className="truncate text-[13px] font-semibold">{title}</h2>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] tabular-nums text-ink-muted">
          {overdue > 0 && <span className="rounded bg-bad-soft px-1.5 py-0.5 text-bad">{overdue} late</span>}
          {cards.length}
        </span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {cards.map((c) => <PersonCard key={c.id} card={c} syncing={pending.has(c.id)} />)}
        {cards.length === 0 && (
          <div className={clsx("grid h-24 place-items-center rounded-lg border border-dashed text-xs transition",
            isOver ? "border-accent/50 text-accent" : "border-line text-ink-faint")}>
            Drop a card here
          </div>
        )}
      </div>
    </section>
  );
}
