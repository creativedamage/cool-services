"use client";
/** Lists of purchase orders, bills and work orders (the Purchasing page and a job's Purchasing tab). */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PurchasingPage } from "@shared/ops/purchasing";
import { fmtDate, fmtMoney, ops } from "@/lib/ops";
import { Card, Empty, ErrorBox, Field, Table } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";
import { BillPill, day, PoPill, WoPill } from "./bits";

export function PoTable({ rows, hideJob }: { rows: PurchasingPage["pos"]; hideJob?: boolean }) {
  const router = useRouter();
  if (!rows.length) return <Card><Empty>No purchase orders here. Order a job's gear from its Purchasing tab, or start one with New purchase order.</Empty></Card>;
  return (
    <Card>
      <Table min={760} head={<tr><th>PO</th><th>Vendor</th>{!hideJob && <th>Job</th>}<th>Needed by</th><th>Status</th><th>Received</th><th className="text-right">Total</th></tr>}>
        {rows.map((p) => (
          <tr key={p.id} className="cursor-pointer hover:bg-hover/40" onClick={() => router.push(`/avl/purchasing/po?id=${p.id}`)}>
            <td><div className="font-mono text-xs font-semibold">{p.number}</div><div className="text-[11px] text-ink-faint">{fmtDate(p.createdAt)}{p.createdBy ? ` · ${p.createdBy}` : ""}</div></td>
            <td className="font-medium">{p.vendor?.name ?? "—"}</td>
            {!hideJob && <td className="text-xs">{p.job ? `${p.job.number} · ${p.job.name}` : <span className="text-ink-faint">Stock</span>}</td>}
            <td className="text-xs">{day(p.expectedDate)}</td>
            <td><PoPill s={p.status} /></td>
            <td className="w-28">{["ORDERED", "PARTIAL", "RECEIVED"].includes(p.status) ? <div className="flex items-center gap-2"><div className="h-1.5 flex-1 rounded-full bg-hover"><div className="h-1.5 rounded-full bg-ok" style={{ width: `${p.receivedPct}%` }} /></div><span className="text-[11px] tabular-nums text-ink-muted">{p.receivedPct}%</span></div> : <span className="text-xs text-ink-faint">—</span>}</td>
            <td className="text-right font-mono">{fmtMoney(p.totalCents)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

export function NewPoModal({ page, onClose, jobId }: { page: PurchasingPage; onClose: () => void; jobId?: string }) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState("");
  const [job, setJob] = useState(jobId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="New purchase order" width={480}>
      <form className="space-y-3 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { const p = await ops<{ id: string }>("/pos", { json: { vendorId, jobId: job || null, lines: [] } }); router.push(`/avl/purchasing/po?id=${p.id}`); }
        catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <Field label="Vendor"><select required className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">Pick a vendor…</option>{page.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
        <Field label="For job" hint="Leave it empty for stock (the shop's own inventory)."><select className="input" value={job} onChange={(e) => setJob(e.target.value)}><option value="">Stock (no job)</option>{page.jobs.map((j) => <option key={j.id} value={j.id}>{j.number} · {j.name}</option>)}</select></Field>
        {!page.vendors.length && <p className="text-xs text-ink-muted">Add your vendors under Vendors first.</p>}
        {error && <ErrorBox error={new Error(error)} />}
        <div className="flex justify-end gap-2 pt-1"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !vendorId}>{busy && <Spinner />} Start the order</button></div>
      </form>
    </Modal>
  );
}

export function BillTable({ rows, empty, hideJob }: { rows: PurchasingPage["bills"]; empty: string; hideJob?: boolean }) {
  const router = useRouter();
  return (
    <Card>
      {rows.length ? (
        <Table min={760} head={<tr><th>Vendor</th><th>Bill #</th>{!hideJob && <th>Job</th>}<th>PO</th><th>Billed</th><th>Due</th><th>Status</th><th className="text-right">Amount</th></tr>}>
          {rows.map((b) => (
            <tr key={b.id} className="cursor-pointer hover:bg-hover/40" onClick={() => router.push(`/avl/purchasing/bill?id=${b.id}`)}>
              <td className="font-medium">{b.vendor?.name ?? "—"}</td><td className="font-mono text-xs">{b.billNumber ?? "—"}</td>
              {!hideJob && <td className="text-xs">{b.job ? `${b.job.number} · ${b.job.name}` : "—"}</td>}<td className="font-mono text-xs">{b.po?.number ?? "—"}</td>
              <td className="text-xs">{day(b.billDate)}</td><td className="text-xs">{day(b.dueDate)}</td><td><BillPill s={b.status} overdue={b.overdue} /></td>
              <td className="text-right font-mono">{fmtMoney(b.totalCents)}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{empty}</Empty>}
    </Card>
  );
}

export function WoTable({ rows, empty, hideJob }: { rows: PurchasingPage["workOrders"]; empty: string; hideJob?: boolean }) {
  const router = useRouter();
  return (
    <Card>
      {rows.length ? (
        <Table min={720} head={<tr><th>Work order</th><th>For</th>{!hideJob && <th>Job</th>}<th>Due</th><th>Status</th><th className="text-right">Amount</th></tr>}>
          {rows.map((w) => (
            <tr key={w.id} className="cursor-pointer hover:bg-hover/40" onClick={() => router.push(`/avl/purchasing/wo?id=${w.id}`)}>
              <td><div className="font-medium">{w.title}</div><div className="font-mono text-[11px] text-ink-faint">{w.number}</div></td>
              <td className="text-sm">{w.who ?? "—"}</td>{!hideJob && <td className="text-xs">{w.job.number} · {w.job.name}</td>}<td className="text-xs">{day(w.dueDate)}</td>
              <td><WoPill s={w.status} /></td><td className="text-right font-mono">{fmtMoney(w.totalCents)}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{empty}</Empty>}
    </Card>
  );
}
