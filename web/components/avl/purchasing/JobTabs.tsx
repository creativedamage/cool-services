"use client";
/**
 * A job's purchasing (its POs, work orders and bills, and ordering straight from the budget), its
 * job costing (budget against committed, actual and projected cost) and its change orders.
 */
import clsx from "clsx";
import { CheckCircle2, Circle, Hammer, Plus, Receipt, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { JobPage } from "@shared/ops/jobs";
import type { CostingRow, JobCosting, JobPurchasing, OrderableLine } from "@shared/ops/purchasing";
import { fmtMoney, fmtPct, money0, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Empty, ErrorBox, KpiRow, Loading, MoneyInput, Table } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";
import { BillTable, NewPoModal, PoTable, WoTable } from "./Lists";
import { CoPill, LinkChips } from "./bits";

/* ───────────── Purchasing ───────────── */

export function JobPurchasingTab({ page }: { page: JobPage }) {
  const d = useOps<JobPurchasing>(`/jobs/${page.job.id}/purchasing`);
  const router = useRouter();
  const [modal, setModal] = useState<"order" | "po" | null>(null);
  const [busy, setBusy] = useState(false);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const p = d.data;
  const newWo = async () => {
    setBusy(true);
    try { const w = await ops<{ id: string }>(`/jobs/${page.job.id}/work-orders`, { json: { title: "New work order", lines: [] } }); router.push(`/avl/purchasing/wo?id=${w.id}`); }
    catch (e) { toast.error((e as Error).message); setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{p.orderable.length ? <>{p.orderable.length} material line{p.orderable.length === 1 ? "" : "s"} on the budget still to order.</> : "Everything on the budget is on a purchase order."}</p>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-ghost" href={`/avl/purchasing/bill?new=1&job=${page.job.id}`}><Receipt size={14} /> Enter a bill</Link>
          <button className="btn-ghost" disabled={busy} onClick={() => void newWo()}>{busy ? <Spinner /> : <Hammer size={14} />} Work order</button>
          <button className="btn-outline" onClick={() => setModal("po")}><Plus size={14} /> Blank PO</button>
          <button className="btn-primary" disabled={!p.orderable.length} onClick={() => setModal("order")}><ShoppingCart size={14} /> Order from the budget</button>
        </div>
      </div>
      {p.counts.waitingApproval > 0 && <p className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-2 text-sm text-warn">{p.counts.waitingApproval} purchase order{p.counts.waitingApproval === 1 ? " is" : "s are"} waiting for an AVL Manager's approval.</p>}
      <div><div className="label mb-2">Purchase orders</div><PoTable rows={p.pos} hideJob /></div>
      <div><div className="label mb-2">Work orders</div><WoTable rows={p.workOrders} hideJob empty="No work orders. Make one for a subcontractor or installer (electrician, rigging, low-voltage crew)." /></div>
      <div><div className="label mb-2">Vendor bills</div><BillTable rows={p.bills} hideJob empty="No bills yet. Enter one from a received purchase order, or with Enter a bill." /></div>
      {modal === "order" && <OrderModal jobId={page.job.id} lines={p.orderable} vendors={p.vendors} onClose={() => setModal(null)} onDone={() => { setModal(null); void d.refetch(); }} />}
      {modal === "po" && <NewPoModal page={p} jobId={page.job.id} onClose={() => setModal(null)} />}
    </div>
  );
}

function OrderModal({ jobId, lines, vendors, onClose, onDone }: { jobId: string; lines: OrderableLine[]; vendors: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const refresh = useOpsRefresh();
  const router = useRouter();
  const [pick, setPick] = useState<Record<string, { on: boolean; vendorId: string; qty: number; cost: number }>>(
    Object.fromEntries(lines.map((l) => [l.budgetItemId, { on: true, vendorId: l.vendorId ?? "", qty: l.remainingQty, cost: l.unitCostCents }])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = lines.filter((l) => pick[l.budgetItemId].on);
  const byVendor = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of chosen) { const p = pick[l.budgetItemId]; if (p.vendorId) m.set(p.vendorId, (m.get(p.vendorId) ?? 0) + p.qty * p.cost); }
    return m;
  }, [chosen, pick]);
  const up = (id: string, x: Partial<(typeof pick)[string]>) => setPick({ ...pick, [id]: { ...pick[id], ...x } });
  const missing = chosen.filter((l) => !pick[l.budgetItemId].vendorId).length;
  return (
    <Modal open onClose={onClose} title="Order from the budget" width={980}>
      <div className="max-h-[58vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_th]:px-3 [&_th]:py-2"><tr><th className="w-8" /><th>Budget line</th><th className="w-52">Vendor</th><th className="w-28 text-right">Left to order</th><th className="w-24">Order</th><th className="w-32 text-right">Unit cost</th></tr></thead>
          <tbody className="divide-y divide-line [&_td]:px-3 [&_td]:py-2">
            {lines.map((l) => {
              const p = pick[l.budgetItemId];
              return (
                <tr key={l.budgetItemId} className={clsx(!p.on && "opacity-50")}>
                  <td><input type="checkbox" checked={p.on} onChange={(e) => up(l.budgetItemId, { on: e.target.checked })} /></td>
                  <td><div className="font-medium">{l.name}</div><div className="text-[11px] text-ink-faint">{[l.group, l.sku].filter(Boolean).join(" · ")}{l.orderedQty ? ` · ${l.orderedQty} already ordered` : ""}</div></td>
                  <td><select className={clsx("input py-1 text-xs", p.on && !p.vendorId && "border-warn")} value={p.vendorId} onChange={(e) => up(l.budgetItemId, { vendorId: e.target.value })}><option value="">Pick a vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></td>
                  <td className="text-right tabular-nums text-ink-muted">{l.remainingQty} {l.unit ?? ""}</td>
                  <td><input type="number" min={1} className="input min-w-[5rem] py-1 tabular-nums" value={p.qty} onChange={(e) => up(l.budgetItemId, { qty: Math.max(1, parseInt(e.target.value) || 1) })} /></td>
                  <td><MoneyInput cents={p.cost} onChange={(c) => up(l.budgetItemId, { cost: c ?? 0 })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 border-t border-line p-4">
        {byVendor.size > 0 && <div className="flex flex-wrap gap-2 text-xs">{[...byVendor].map(([v, c]) => <span key={v} className="rounded-full bg-hover px-2.5 py-1">{vendors.find((x) => x.id === v)?.name}: <b className="font-mono">{fmtMoney(c)}</b></span>)}</div>}
        <p className="text-[11px] text-ink-faint">One draft purchase order per vendor. Each goes to an AVL Manager for approval before it's sent.</p>
        {error && <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !chosen.length || missing > 0} onClick={async () => {
            setBusy(true); setError(null);
            try {
              const made = await ops<{ id: string; number: string; vendor: string }[]>(`/jobs/${jobId}/pos-from-budget`, { json: { lines: chosen.map((l) => ({ budgetItemId: l.budgetItemId, vendorId: pick[l.budgetItemId].vendorId, quantity: pick[l.budgetItemId].qty, unitCostCents: pick[l.budgetItemId].cost })) } });
              void refresh();
              toast.success(`${made.length} purchase order${made.length === 1 ? "" : "s"} made: ${made.map((m) => m.vendor).join(", ")}`);
              if (made.length === 1) router.push(`/avl/purchasing/po?id=${made[0].id}`); else onDone();
            } catch (e) { setError((e as Error).message); setBusy(false); }
          }}>{busy ? <Spinner /> : <ShoppingCart size={14} />} {missing ? `Pick a vendor for ${missing} line${missing === 1 ? "" : "s"}` : `Make ${byVendor.size} purchase order${byVendor.size === 1 ? "" : "s"}`}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────── Job costing ───────────── */

type CostCol = "budget" | "committed" | "actual" | "projected" | "remaining";
export function JobCostingTab({ page, church }: { page: JobPage; church: boolean }) {
  const d = useOps<JobCosting>(`/jobs/${page.job.id}/costing`);
  const refresh = useOpsRefresh();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const c = d.data;
  const t = c.totals;
  if (!c.rows.length) return <Card><Empty>Nothing in the budget yet. Job costing compares the budget with purchase orders, bills and time as they come in.</Empty></Card>;
  // Groups with no cost items under them (empty default groups) stay out of the way.
  const full = new Set<string>();
  for (const r of c.rows) if (r.kind !== "GROUP") for (let p = r.parentId; p && !full.has(p); p = c.rows.find((x) => x.id === p)?.parentId ?? null) full.add(p);
  const hidden = (r: CostingRow) => { if (r.kind === "GROUP" && !full.has(r.id)) return true; for (let p = r.parentId; p; p = c.rows.find((x) => x.id === p)?.parentId ?? null) if (open[p] === false) return true; return false; };
  const toggleFinal = async (r: CostingRow) => {
    try { await ops(`/budget-items/${r.id}/final`, { method: "PUT", json: { final: !r.final } }); await d.refetch(); void refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const cell = (v: number, kind: CostCol, r?: CostingRow) => {
    const over = kind === "projected" && r && r.projectedCents > r.budgetCents;
    const neg = kind === "remaining" && v < 0;
    return <td className={clsx("text-right font-mono tabular-nums", !v && "text-ink-faint", over && "text-bad", neg && "text-bad", kind === "remaining" && v > 0 && "text-ok")}>{v ? fmtMoney(v) : "—"}</td>;
  };
  return (
    <div className="space-y-4">
      <KpiRow items={church ? [
        { value: money0(t.budgetCents), label: "Budget" },
        { value: money0(t.actualCents), label: "Spent so far" },
        { value: money0(t.committedCents), label: "Committed (orders)" },
        { value: money0(t.remainingCents), label: t.remainingCents < 0 ? "Over budget" : "Left in the budget", tone: t.remainingCents < 0 ? "bad" : "ok" },
      ] : [
        { value: money0(t.committedCents), label: "Committed (POs, work orders)" },
        { value: money0(t.actualCents), label: "Actual (bills, time)" },
        { value: money0(t.projectedCents), label: `Projected cost · budget ${money0(t.budgetCents)}`, tone: t.projectedCents > t.budgetCents ? "bad" : undefined },
        { value: t.priceCents ? fmtPct(t.projectedMarginBps) : "—", label: `Projected margin · ${money0(t.projectedProfitCents)} profit`, tone: t.projectedMarginBps < 1500 ? "bad" : t.projectedMarginBps < 2500 ? "warn" : "ok" },
      ]} />
      {(c.openBillsCents > 0 || c.waitingApproval > 0) && (
        <div className="flex flex-wrap gap-2 text-sm">
          {c.waitingApproval > 0 && <Link href={`/avl/jobs/view?id=${page.job.id}&tab=purchasing`} className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-1.5 text-warn">{c.waitingApproval} PO{c.waitingApproval === 1 ? "" : "s"} waiting for approval</Link>}
          {c.openBillsCents > 0 && <Link href={`/avl/jobs/view?id=${page.job.id}&tab=purchasing`} className="rounded-lg border border-line px-3 py-1.5 text-ink-soft">{fmtMoney(c.openBillsCents)} in bills to pay</Link>}
        </div>
      )}
      <Card eyebrow="Job costing" title="Budget against what's committed and spent">
        <Table min={980} head={<tr><th>Cost item</th><th className="w-28 text-right">Budgeted</th><th className="w-28 text-right">Committed</th><th className="w-28 text-right">Actual</th><th className="w-28 text-right">Projected</th><th className="w-28 text-right">Remaining</th><th className="w-20 text-center">Final</th></tr>}>
          {c.rows.filter((r) => !hidden(r)).map((r) => r.kind === "GROUP" ? (
            <tr key={r.id} className="cursor-pointer bg-hover/40 font-semibold" onClick={() => setOpen({ ...open, [r.id]: open[r.id] === false })}>
              <td style={{ paddingLeft: 12 + r.depth * 18 }}>{open[r.id] === false ? "▸" : "▾"} {r.name}</td>
              {cell(r.budgetCents, "budget")}{cell(r.committedCents, "committed")}{cell(r.actualCents, "actual")}{cell(r.projectedCents, "projected", r)}{cell(r.remainingCents, "remaining")}<td />
            </tr>
          ) : (
            <tr key={r.id} className={clsx(r.projectedCents > r.budgetCents && "bg-bad-soft/20")}>
              <td style={{ paddingLeft: 12 + r.depth * 18 }}>
                <div>{r.name}</div>
                <LinkChips links={r.links} />
                {r.timeCents > 0 && <div className="text-[11px] text-ink-faint">includes {fmtMoney(r.timeCents)} of logged time</div>}
              </td>
              {cell(r.budgetCents, "budget")}{cell(r.committedCents, "committed")}{cell(r.actualCents, "actual")}{cell(r.projectedCents, "projected", r)}{cell(r.remainingCents, "remaining")}
              <td className="text-center"><button title={r.final ? "All costs are in (click to undo)" : "Mark final: all its costs are in"} className={clsx("p-1", r.final ? "text-ok" : "text-ink-faint hover:text-ink")} onClick={() => void toggleFinal(r)}>{r.final ? <CheckCircle2 size={16} /> : <Circle size={16} />}</button></td>
            </tr>
          ))}
          {(c.unassigned.committedCents !== 0 || c.unassigned.actualCents !== 0) && (
            <tr className="text-ink-soft">
              <td><div>Not on a budget line</div><div className="text-[11px] text-ink-faint">Shipping, tax and extras on POs and bills, and lines not tied to the budget</div><LinkChips links={c.unassigned.links} /></td>
              <td className="text-right text-ink-faint">—</td>{cell(c.unassigned.committedCents, "committed")}{cell(c.unassigned.actualCents, "actual")}{cell(Math.max(c.unassigned.committedCents, c.unassigned.actualCents), "projected")}<td className="text-right font-mono text-bad">{fmtMoney(-Math.max(c.unassigned.committedCents, c.unassigned.actualCents))}</td><td />
            </tr>
          )}
          {c.unplacedTimeCents > 0 && (
            <tr className="text-ink-soft"><td><div>Logged time</div><div className="text-[11px] text-ink-faint">No labor line in the budget to put it on</div></td><td className="text-right text-ink-faint">—</td><td className="text-right text-ink-faint">—</td>{cell(c.unplacedTimeCents, "actual")}{cell(c.unplacedTimeCents, "projected")}<td className="text-right font-mono text-bad">{fmtMoney(-c.unplacedTimeCents)}</td><td /></tr>
          )}
          <tr className="border-t-2 border-line font-semibold">
            <td>Whole job</td>{cell(t.budgetCents, "budget")}{cell(t.committedCents, "committed")}{cell(t.actualCents, "actual")}
            <td className={clsx("text-right font-mono", t.projectedCents > t.budgetCents && "text-bad")}>{fmtMoney(t.projectedCents)}</td>
            <td className={clsx("text-right font-mono", t.remainingCents < 0 ? "text-bad" : "text-ok")}>{fmtMoney(t.remainingCents)}</td><td />
          </tr>
        </Table>
      </Card>
      <p className="text-[11px] text-ink-faint">Committed: approved purchase orders and sent work orders. Actual: vendor bills, and logged time (spread over the labor lines by their budget). Projected: the largest of budgeted, committed and actual, or actual once a line is marked final.</p>
    </div>
  );
}

/* ───────────── Change orders ───────────── */

export function JobChangesTab({ page }: { page: JobPage }) {
  const d = useOps<JobPurchasing>(`/jobs/${page.job.id}/purchasing`);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const cos = d.data.changeOrders;
  const approved = cos.filter((c) => c.status === "APPROVED").reduce((s, c) => s + c.totalCents, 0);
  const waiting = cos.filter((c) => c.status === "SENT").reduce((s, c) => s + c.totalCents, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{cos.length ? <>Approved changes: <b className="font-mono text-ink">{fmtMoney(approved)}</b>{waiting ? <> · waiting on the client: <b className="font-mono text-ink">{fmtMoney(waiting)}</b></> : null}</> : "Scope that changes after the sale: added gear, extra labor, credits."}</p>
        <button className="btn-primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try { const c = await ops<{ id: string }>(`/jobs/${page.job.id}/change-orders`, { json: { title: "Change order", lines: [] } }); router.push(`/avl/jobs/change-order?id=${c.id}`); }
          catch (e) { toast.error((e as Error).message); setBusy(false); }
        }}>{busy ? <Spinner /> : <Plus size={14} />} New change order</button>
      </div>
      <Card>
        {cos.length ? (
          <Table min={640} head={<tr><th>Change order</th><th>Status</th><th>Made</th><th className="text-right">Amount</th></tr>}>
            {cos.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-hover/40" onClick={() => router.push(`/avl/jobs/change-order?id=${c.id}`)}>
                <td><div className="font-medium">{c.title}</div><div className="font-mono text-[11px] text-ink-faint">{c.number}</div></td>
                <td><CoPill s={c.status} /></td>
                <td className="text-xs">{new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                <td className={clsx("text-right font-mono", c.totalCents < 0 && "text-bad")}>{fmtMoney(c.totalCents)}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No change orders yet. When the client adds or drops something, make a change order: they sign it online and its lines join the budget.</Empty>}
      </Card>
    </div>
  );
}
