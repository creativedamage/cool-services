"use client";
/** The Sundays admin console (super admins): organizations, plans, billing. */
import { AdminBody } from "@/components/ops/OpsGate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminBody>{children}</AdminBody>;
}
