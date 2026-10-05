"use client";
/** Sundays | AVL (Full Mode): the same sign-in as Operations, then the page. */
import { OpsAppBody } from "@/components/ops/OpsGate";

export default function AvlLayout({ children }: { children: React.ReactNode }) {
  return <OpsAppBody app="avl">{children}</OpsAppBody>;
}
