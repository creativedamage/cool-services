"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { VendorRow } from "@shared/ops/types";
import { ops, useOpsRefresh } from "@/lib/ops";
import { Field } from "./OpsUi";

type V = Pick<VendorRow, "name" | "accountNo" | "repName" | "repEmail" | "repPhone" | "website" | "terms" | "notes">;
const EMPTY: V = { name: "", accountNo: "", repName: "", repEmail: "", repPhone: "", website: "", terms: "", notes: "" };

export function VendorForm({ vendor, onDone }: { vendor?: VendorRow; onDone?: () => void }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const [v, setV] = useState<V>(vendor ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const field = (k: keyof V, label: string, type = "text") => (
    <Field label={label}><input type={type} className="input" value={(v[k] as string) ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} required={k === "name"} /></Field>
  );
  return (
    <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try {
        const res = await ops<{ id: string }>(vendor ? `/vendors/${vendor.id}` : "/vendors", { method: vendor ? "PUT" : "POST", json: v });
        toast.success(vendor ? "Vendor saved" : "Vendor added");
        await refresh();
        if (!vendor) router.push(`/ops/vendors/view?id=${res.id}`);
        onDone?.();
      } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
    }}>
      {field("name", "Vendor name")}{field("accountNo", "Account #")}{field("terms", "Terms")}{field("website", "Website")}
      {field("repName", "Rep name")}{field("repEmail", "Rep email", "email")}{field("repPhone", "Rep phone")}
      <div className="flex items-end"><button className="btn-primary" disabled={busy}>{vendor ? "Save vendor" : "Add vendor"}</button></div>
    </form>
  );
}
