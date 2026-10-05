"use client";
/**
 * The campus you're looking at. It starts at your default campus (Preferences → Campuses) each time
 * Sundays opens, and the switcher in the sidebar changes it for now. "all" shows every campus.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { create } from "zustand";
import { Api, qk } from "@/lib/api";

const useStore = create<{ current: string | null | undefined; set: (id: string | null) => void }>((set) => ({
  current: undefined, // not chosen yet: follows the default once it loads
  set: (current) => set({ current }),
}));

export function useCampus() {
  const q = useQuery({ queryKey: qk.campuses, queryFn: Api.campuses, staleTime: 5 * 60_000 });
  const { current, set } = useStore();
  const campuses = q.data?.campuses ?? [];
  useEffect(() => { if (current === undefined && q.data) set(q.data.myDefault); }, [current, q.data, set]);
  const id = current === undefined ? q.data?.myDefault ?? null : current;
  const campus = campuses.find((c) => c.id === id) ?? null;
  const types = campus ? new Set(campus.serviceTypeIds) : null;
  return {
    campuses, campus, myDefault: q.data?.myDefault ?? null, loaded: Boolean(q.data),
    setCampus: set,
    /** Is this service type in the campus you're looking at (always true for "All campuses")? */
    shows: (serviceTypeId: string) => !types || types.has(serviceTypeId),
  };
}
