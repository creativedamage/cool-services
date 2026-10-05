"use client";
/** Sundays | Operations (Full Mode): its own sign-in, then the page. */
import { OpsAppBody } from "@/components/ops/OpsGate";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <OpsAppBody app="ops">{children}</OpsAppBody>;
}
