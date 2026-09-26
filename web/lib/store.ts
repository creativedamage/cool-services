"use client";
import { create } from "zustand";

/**
 * Ephemeral UI state for the Kanban board and scheduling.
 * Server state (board, notes, plans) lives in React Query; optimistic card moves are
 * applied to the React Query cache and tracked here as `pending` so cards can show a sync state
 * and background refetches pause while a move is in flight.
 */
interface UiState {
  // Kanban
  activeCardId: string | null;
  drawerCardId: string | null;
  drawerTab: "notes" | "email";
  search: string;
  onlyOverdue: boolean;
  pending: Set<string>;
  setActive: (id: string | null) => void;
  openDrawer: (id: string, tab?: "notes" | "email") => void;
  closeDrawer: () => void;
  setSearch: (s: string) => void;
  toggleOverdue: () => void;
  markPending: (id: string, on: boolean) => void;

  // Scheduling (shared by Kanban quick-action and Services view)
  scheduleFor: { personId: string; name: string; avatarUrl: string | null } | null;
  openSchedule: (p: UiState["scheduleFor"]) => void;
  closeSchedule: () => void;
}

export const useUi = create<UiState>((set) => ({
  activeCardId: null,
  drawerCardId: null,
  drawerTab: "notes",
  search: "",
  onlyOverdue: false,
  pending: new Set(),
  setActive: (activeCardId) => set({ activeCardId }),
  openDrawer: (drawerCardId, drawerTab = "notes") => set({ drawerCardId, drawerTab }),
  closeDrawer: () => set({ drawerCardId: null }),
  setSearch: (search) => set({ search }),
  toggleOverdue: () => set((s) => ({ onlyOverdue: !s.onlyOverdue })),
  markPending: (id, on) =>
    set((s) => {
      const pending = new Set(s.pending);
      on ? pending.add(id) : pending.delete(id);
      return { pending };
    }),

  scheduleFor: null,
  openSchedule: (scheduleFor) => set({ scheduleFor }),
  closeSchedule: () => set({ scheduleFor: null }),
}));
