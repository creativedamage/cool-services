"use client";
import { createContext, useContext } from "react";
import type { OpsMe } from "@shared/ops/types";

export type OpsOk = Extract<OpsMe, { status: "ok" }>;
export const OpsMeContext = createContext<OpsOk | null>(null);
/** The signed-in Church Ops person (inside the ops pages). */
export function useOpsUser(): OpsOk {
  const v = useContext(OpsMeContext);
  if (!v) throw new Error("useOpsUser outside Church Ops");
  return v;
}
