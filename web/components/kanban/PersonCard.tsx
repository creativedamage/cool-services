"use client";
import { useDraggable } from "@dnd-kit/core";
import clsx from "clsx";
import { CalendarPlus, Clock, Mail, MessageSquareText, Phone } from "lucide-react";
import type { WorkflowCard } from "@shared/types";
import { relDays } from "@/lib/format";
import { useUi } from "@/lib/store";
import { Avatar, Spinner } from "@/components/ui";

export function PersonCard({ card, overlay, syncing }: { card: WorkflowCard; overlay?: boolean; syncing?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, disabled: overlay });
  const { openDrawer, openSchedule } = useUi();
  const p = card.person;

  // Stop pointer events on action buttons from starting a drag.
  const act = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); fn(); },
  });

  return (
    <article
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
      onClick={() => openDrawer(card.id)}
      className={clsx(
        "group relative cursor-grab select-none rounded-lg border bg-raised p-3 shadow-card transition active:cursor-grabbing",
        overlay ? "rotate-[1.5deg] border-accent/40 shadow-lift" : "border-line hover:border-line-strong",
        isDragging && "opacity-30",
        card.overdue && !overlay && "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r before:bg-bad",
      )}
    >
      <div className="flex gap-3">
        <Avatar name={p.name} src={p.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold">{p.name}</div>
            {syncing && <span className="text-accent"><Spinner size={11} /></span>}
          </div>
          {p.email && (
            <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-muted">
              <Mail size={11} className="shrink-0" /> <span className="truncate">{p.email}</span>
            </div>
          )}
          {p.phone && (
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
              <Phone size={11} className="shrink-0" /> {p.phone}
            </div>
          )}
        </div>
      </div>

      <footer className="mt-3 flex items-center gap-2 border-t border-line/70 pt-2.5">
        <span className={clsx("flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px]", card.overdue ? "text-bad" : "text-ink-muted")}>
          <Clock size={11} /> {relDays(card.movedToStepAt)}
        </span>
        {card.assigneeName && (
          <span className="min-w-0 truncate rounded bg-hover px-1.5 py-0.5 text-[10px] text-ink-soft">{card.assigneeName}</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-70 transition group-hover:opacity-100">
          <IconBtn label="Email" {...act(() => openDrawer(card.id, "email"))}><Mail size={14} /></IconBtn>
          <IconBtn label="Notes" {...act(() => openDrawer(card.id, "notes"))}>
            <MessageSquareText size={14} />
            {card.noteCount > 0 && <span className="text-[10px] tabular-nums">{card.noteCount}</span>}
          </IconBtn>
          <IconBtn label="Schedule in Services" accent
            {...act(() => openSchedule({ personId: p.id, name: p.name, avatarUrl: p.avatarUrl }))}>
            <CalendarPlus size={14} />
          </IconBtn>
        </div>
      </footer>
    </article>
  );
}

function IconBtn({ children, label, accent, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; accent?: boolean }) {
  return (
    <button {...rest} title={label} aria-label={label}
      className={clsx("flex items-center gap-1 rounded-md p-1.5 transition",
        accent ? "text-accent hover:bg-accent-soft" : "text-ink-muted hover:bg-hover hover:text-ink")}>
      {children}
    </button>
  );
}
