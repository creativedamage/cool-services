"use client";
/**
 * Upcoming plans, loaded one service type at a time so each shows (and can be opened) as soon as
 * it arrives, instead of waiting for every service type.
 */
import { useQueries, useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { PlanSummary, ServiceType } from "@shared/types";
import { Api, qk } from "@/lib/api";

export const serviceTypesQuery = { queryKey: qk.serviceTypes, queryFn: Api.serviceTypes, staleTime: 10 * 60_000 };
export const typePlansQuery = (st: string) => ({ queryKey: qk.typePlans(st), queryFn: () => Api.plans(st), staleTime: 60_000 });

export function usePlans(opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  const enabled = opts.enabled ?? true;
  const types = useQuery({ ...serviceTypesQuery, enabled });
  const results = useQueries({
    queries: (types.data ?? []).map((t) => ({ ...typePlansQuery(t.id), enabled, refetchInterval: opts.refetchInterval })),
  });
  const stamp = results.map((r) => r.dataUpdatedAt).join(",");
  const data = useMemo<PlanSummary[] | undefined>(() => {
    if (!types.data) return undefined;
    const got = results.filter((r) => r.data).flatMap((r) => r.data!);
    if (!got.length && results.some((r) => r.isLoading)) return undefined;
    return got.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  }, [types.data, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Service types whose plans haven't arrived yet. */
  const pending: ServiceType[] = (types.data ?? []).filter((_, i) => results[i]?.isLoading);
  return {
    data,
    types: types.data,
    isLoading: types.isLoading || (data === undefined && enabled),
    pending,
    error: types.error ?? results.find((r) => r.error)?.error ?? null,
  };
}

/** Warm the cache: service types, then each type's plans (they arrive independently). */
export async function prefetchPlans(qc: QueryClient) {
  const types = await qc.fetchQuery(serviceTypesQuery).catch(() => [] as ServiceType[]);
  for (const t of types) void qc.prefetchQuery(typePlansQuery(t.id));
}
