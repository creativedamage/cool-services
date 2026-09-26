"use client";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, RefreshCw, Search } from "lucide-react";
import clsx from "clsx";
import { useMemo } from "react";
import { toast } from "sonner";
import type { Board, WorkflowCard } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { useUi } from "@/lib/store";
import { Skeleton, Spinner } from "@/components/ui";
import { KanbanColumn, DONE_ID } from "./KanbanColumn";
import { PersonCard } from "./PersonCard";
import { CardDrawer } from "./CardDrawer";

export function KanbanBoard({ workflowId }: { workflowId: string }) {
  const qc = useQueryClient();
  const key = qk.board(workflowId);
  const { activeCardId, setActive, pending, markPending, search, setSearch, onlyOverdue, toggleOverdue } = useUi();

  // Live-ish sync: poll every 20s, but never while a drag or a move is in flight.
  const board = useQuery({
    queryKey: key,
    queryFn: () => Api.board(workflowId),
    refetchInterval: activeCardId || pending.size ? false : 20_000,
  });

  const move = useMutation({
    mutationFn: (v: { card: WorkflowCard; toStepId: string | null }) => Api.moveCard(workflowId, v.card.id, v.toStepId, v.card.personId),
    onMutate: async ({ card, toStepId }) => {
      await qc.cancelQueries({ queryKey: key });
      markPending(card.id, true);
      qc.setQueryData<Board>(key, (b) => b && {
        ...b,
        cards: toStepId === null
          ? b.cards.filter((c) => c.id !== card.id)
          : b.cards.map((c) => (c.id === card.id ? { ...c, stepId: toStepId, movedToStepAt: new Date().toISOString(), overdue: false } : c)),
      });
      return { card };
    },
    // Roll back only this card, so concurrent moves of other cards are unaffected.
    onError: (err, _v, ctx) => {
      if (ctx) {
        qc.setQueryData<Board>(key, (b) => b && {
          ...b,
          cards: [...b.cards.filter((c) => c.id !== ctx.card.id), ctx.card],
        });
      }
      toast.error("Couldn’t move card in Planning Center", { description: (err as Error).message });
    },
    onSuccess: (fresh, { toStepId }) => {
      if (toStepId === null) {
        toast.success(`${fresh.person.firstName} completed the workflow 🎉`);
        return;
      }
      qc.setQueryData<Board>(key, (b) => b && { ...b, cards: b.cards.map((c) => (c.id === fresh.id ? { ...c, ...fresh, person: c.person } : c)) });
    },
    onSettled: (_d, _e, { card }) => {
      markPending(card.id, false);
      qc.invalidateQueries({ queryKey: qk.workflows });
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // lets buttons inside cards still click
    useSensor(KeyboardSensor),
  );

  // Email/phone load after the cards are on screen.
  const missing = useMemo(() => (board.data?.cards ?? []).filter((c) => !c.person.email && !c.person.phone).map((c) => c.personId).sort(), [board.data]);
  const contacts = useQuery({
    queryKey: [...qk.contacts(workflowId), missing.join(",")],
    queryFn: () => Api.contacts(missing),
    enabled: missing.length > 0,
    staleTime: 3600_000,
    placeholderData: (prev) => prev,
  });
  const cardsWithContacts = useMemo(() => (board.data?.cards ?? []).map((c) => {
    const extra = contacts.data?.[c.personId];
    return extra && !c.person.email && !c.person.phone ? { ...c, person: { ...c.person, ...extra } } : c;
  }), [board.data, contacts.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cardsWithContacts.filter((c) =>
      (!onlyOverdue || c.overdue) &&
      (!q || c.person.name.toLowerCase().includes(q) || c.person.email?.toLowerCase().includes(q)),
    );
  }, [cardsWithContacts, search, onlyOverdue]);

  const byStep = useMemo(() => {
    const m = new Map<string, WorkflowCard[]>();
    for (const c of filtered) {
      const k = c.stepId ?? DONE_ID;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    // Longest-waiting first — that's who needs attention.
    for (const list of m.values()) list.sort((a, b) => a.movedToStepAt.localeCompare(b.movedToStepAt));
    return m;
  }, [filtered]);

  const activeCard = cardsWithContacts.find((c) => c.id === activeCardId) ?? null;

  function onDragStart(e: DragStartEvent) {
    setActive(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const card = board.data?.cards.find((c) => c.id === e.active.id);
    if (!card || !e.over) return;
    const target = String(e.over.id);
    const toStepId = target === DONE_ID ? null : target;
    if (toStepId === card.stepId) return;
    move.mutate({ card, toStepId });
  }

  if (board.isLoading) return <BoardSkeleton />;
  if (board.error || !board.data) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-ink-muted">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-2 text-bad" />
          Couldn’t load this workflow. <button className="text-accent underline" onClick={() => board.refetch()}>Retry</button>
        </div>
      </div>
    );
  }

  const { workflow, steps, cards } = board.data;
  const overdue = cards.filter((c) => c.overdue).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4 pr-32">
        <div className="mr-auto">
          <div className="label">People workflow</div>
          <h1 className="text-xl font-semibold tracking-tight">{workflow.name}</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Stat n={cards.length} label="active" />
          <Stat n={overdue} label="overdue" tone={overdue ? "text-bad" : undefined} />
        </div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter people…" className="input w-56 py-1.5 pl-8" />
        </div>
        <button onClick={toggleOverdue} className={clsx("btn-outline", onlyOverdue && "border-bad/40 bg-bad-soft text-bad")}>
          <AlertCircle size={14} /> Overdue
        </button>
        <button onClick={() => board.refetch()} className="btn-ghost p-2" title="Sync with Planning Center">
          {board.isFetching ? <Spinner /> : <RefreshCw size={15} />}
        </button>
      </header>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}
        onDragCancel={() => setActive(null)}>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          {steps.map((s, i) => (
            <KanbanColumn key={s.id} id={s.id} title={s.name} index={i + 1} cards={byStep.get(s.id) ?? []} pending={pending} />
          ))}
          <KanbanColumn id={DONE_ID} title="Complete" done cards={[]} pending={pending} />
        </div>
        <DragOverlay dropAnimation={{ duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" }}>
          {activeCard ? <PersonCard card={activeCard} overlay /> : null}
        </DragOverlay>
      </DndContext>

      <CardDrawer workflowId={workflowId} board={{ ...board.data, cards: cardsWithContacts }} />
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={clsx("text-lg font-semibold tabular-nums", tone)}>{n}</span>
      <span className="text-ink-muted">{label}</span>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 p-4 pt-20">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="w-[300px] space-y-2">
          <Skeleton className="h-8" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ))}
    </div>
  );
}
