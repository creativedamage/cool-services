"use client";
/**
 * Purchasing: every purchase order (waiting for approval, to receive), vendor bill (to pay) and
 * work order, across jobs. A new PO starts here or from a job's budget.
 */
import { Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { PurchasingPage } from "@shared/ops/purchasing";
import { money0, useOps } from "@/lib/ops";
import { ErrorBox, KpiRow, Loading, PageHeader, Tabs } from "@/components/ops/OpsUi";
import { BillTable, NewPoModal, PoTable, WoTable } from "@/components/avl/purchasing/Lists";

type Tab = "pos" | "bills" | "work";
export default function Page() { return <Suspense><Purchasing /></Suspense>; }

function Purchasing() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = (["pos", "bills", "work"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "pos") as Tab;
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [newPo, setNewPo] = useState(false);
  const d = useOps<PurchasingPage>("/purchasing");
  if (!d.data) return <><PageHeader crumb="AVL" title="Purchasing" /><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const { counts } = d.data;
  const pos = d.data.pos.filter((p) => filter === "all" || !["RECEIVED", "CANCELLED"].includes(p.status));
  const bills = d.data.bills.filter((b) => filter === "all" || b.status === "OPEN");
  const work = d.data.workOrders.filter((w) => filter === "all" || !["DONE", "CANCELLED"].includes(w.status));
  return (
    <div className="space-y-5">
      <PageHeader crumb="AVL" title="Purchasing" description="Purchase orders, what's arriving, vendor bills and work orders, across every job."
        actions={<>
          <Link className="btn-outline" href="/avl/purchasing/bill?new=1"><Receipt size={14} /> Enter a bill</Link>
          <button className="btn-primary" onClick={() => setNewPo(true)}><Plus size={14} /> New purchase order</button>
        </>} />
      <KpiRow items={[
        { value: String(counts.waitingApproval), label: d.data.canApprove ? "Waiting for your approval" : "Waiting for approval", tone: counts.waitingApproval ? "warn" : undefined },
        { value: String(counts.toReceive), label: "Ordered, still arriving", tone: "accent" },
        { value: money0(counts.openBillsCents), label: `${counts.openBills} bill${counts.openBills === 1 ? "" : "s"} to pay` },
        { value: String(counts.overdueBills), label: "Bills overdue", tone: counts.overdueBills ? "bad" : "ok" },
      ]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onChange={(t) => router.replace(`/avl/purchasing${t === "pos" ? "" : `?tab=${t}`}`)} items={[
          { key: "pos", label: "Purchase orders", count: d.data.pos.filter((p) => !["RECEIVED", "CANCELLED"].includes(p.status)).length },
          { key: "bills", label: "Bills", count: counts.openBills },
          { key: "work", label: "Work orders", count: d.data.workOrders.filter((w) => !["DONE", "CANCELLED"].includes(w.status)).length },
        ]} />
        <Tabs value={filter} onChange={setFilter} items={[{ key: "open", label: "Open" }, { key: "all", label: "All" }]} />
      </div>
      {tab === "pos" && <PoTable rows={pos} />}
      {tab === "bills" && <BillTable rows={bills} empty={filter === "open" ? "No bills to pay. Enter a vendor’s bill from its purchase order, or with Enter a bill." : "No bills yet."} />}
      {tab === "work" && <WoTable rows={work} empty={`No ${filter === "open" ? "open " : ""}work orders. Make one from a job’s Purchasing tab, for a subcontractor or installer.`} />}
      {newPo && <NewPoModal page={d.data} onClose={() => setNewPo(false)} />}
    </div>
  );
}

