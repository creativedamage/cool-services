"use client";
import { createContext, useContext } from "react";
import type { OpsMe } from "@shared/ops/types";

export type OpsOk = Extract<OpsMe, { status: "ok" }>;
export const OpsMeContext = createContext<OpsOk | null>(null);
/** The signed-in Sundays | Operations person (inside the ops pages). */
export function useOpsUser(): OpsOk {
  const v = useContext(OpsMeContext);
  if (!v) throw new Error("useOpsUser outside Sundays | Operations");
  return v;
}

/** Is this module part of the organization's plan? (Inside Operations / AVL pages.) */
export function useModule(key: import("@shared/ops/billing").ModuleKey): boolean {
  const v = useContext(OpsMeContext);
  return !!v?.nav.modules.includes(key);
}
