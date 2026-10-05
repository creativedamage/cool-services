"use client";
/** A vendor: details, price-list import (CSV / Excel, read on this Mac) and import history. */
import { FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { detectMapping, IMPORT_FIELDS, normalizeRows, type ColumnMapping, type NormalizeResult, type RawRow } from "@shared/ops/vendor-import";
import type { ImportBatchRow, VendorRow } from "@shared/ops/types";
import { fmtMoney, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Loading, PageHeader } from "@/components/ops/OpsUi";
import { VendorForm } from "@/components/ops/VendorForm";
import { Spinner } from "@/components/ui";

export default function Page() { return <Suspense><Vendor /></Suspense>; }

function Vendor() {
  const id = useSearchParams().get("id") ?? "";
  const d = useOps<{ vendor: VendorRow; imports: ImportBatchRow[] }>(id ? `/vendors/${id}` : null);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const { vendor: v, imports } = d.data;
  return (
    <>
      <PageHeader crumb="AVL / Vendors" title={v.name} actions={<Link className="btn-outline" href={`/ops/catalog?vendorId=${v.id}`}>View {v.productCount} products →</Link>} />
      <div className="space-y-5">
        <Card title="Details"><VendorForm key={v.id} vendor={v} /></Card>
        <ImportWizard vendorId={v.id} />
        {imports.length > 0 && (
          <Card title="Import history">
            <ul className="divide-y divide-line text-sm">
              {imports.map((b) => (
                <li key={b.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
                  <span><b className="font-medium">{b.fileName}</b> <span className="text-ink-muted">· {b.uploadedBy}</span></span>
                  <span className="text-ink-muted">+{b.created} new · {b.updated} updated · {b.skipped} skipped · {new Date(b.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

const FIELDS: { key: (typeof IMPORT_FIELDS)[number]; label: string; required?: boolean }[] = [
  { key: "sku", label: "SKU / Part #", required: true }, { key: "cost", label: "Cost", required: true }, { key: "name", label: "Product name" },
  { key: "model", label: "Model" }, { key: "manufacturer", label: "Manufacturer" }, { key: "category", label: "Category" },
  { key: "description", label: "Description" }, { key: "msrp", label: "MSRP" }, { key: "map", label: "MAP" },
];

/** Read the spreadsheet here, map its columns, check it with the server, then import. */
async function readSheet(file: File): Promise<{ headers: string[]; rows: RawRow[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const Papa = (await import("papaparse")).default;
    const text = (await file.text()).replace(/^﻿/, "");
    const res = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: false });
    return { headers: (res.meta.fields ?? []).map((h) => h.trim()), rows: res.data };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<RawRow>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: true, blankrows: true });
    return { headers: rows.length ? Object.keys(rows[0]).map((h) => h.trim()) : [], rows };
  }
  throw new Error("Upload a .csv, .xlsx or .xls file.");
}

function ImportWizard({ vendorId }: { vendorId: string }) {
  const refresh = useOpsRefresh();
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: RawRow[] } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [result, setResult] = useState<NormalizeResult | null>(null);
  const [counts, setCounts] = useState<{ toCreate: number; toUpdate: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(f = file, map = mapping) {
    if (!f) return;
    setError(null); setCounts(null);
    try {
      const r = normalizeRows(f.rows, map);
      setResult(r);
      setBusy(true);
      setCounts(await ops(`/vendors/${vendorId}/import`, { json: { fileName: f.name, rowCount: f.rows.length, products: r.products, errors: r.errors.slice(0, 500) } }));
    } catch (e) { setResult(null); setError((e as Error).message); } finally { setBusy(false); }
  }
  async function commit() {
    if (!file || !result) return;
    setBusy(true);
    try {
      const r = await ops<{ batch: { created: number; updated: number; skipped: number } }>(`/vendors/${vendorId}/import`, { json: { fileName: file.name, rowCount: file.rows.length, products: result.products, errors: result.errors.slice(0, 500), commit: true } });
      toast.success(`Imported: ${r.batch.created} new, ${r.batch.updated} updated, ${r.batch.skipped} skipped`);
      setFile(null); setResult(null); setCounts(null);
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Card title="Import a price list" action={busy ? <Spinner /> : undefined}>
      <div className="space-y-4 p-4">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-5 text-sm text-ink-muted transition hover:border-accent/60 hover:bg-hover/40">
          <FileSpreadsheet size={22} className="text-accent" />
          <span><b className="text-ink">{file ? file.name : "Choose a CSV or Excel file"}</b><br />{file ? `${file.rows.length} rows · ${file.headers.length} columns` : "The vendor's price sheet. Columns are matched for you; adjust them below."}</span>
          <input type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              if (f.size > 15 * 1024 * 1024) throw new Error("That file is over 15 MB.");
              const s = await readSheet(f);
              const next = { name: f.name, ...s };
              const map = detectMapping(s.headers);
              setFile(next); setMapping(map);
              await check(next, map);
            } catch (err) { setError((err as Error).message); }
          }} />
        </label>
        {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        {file && (
          <>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {FIELDS.map((f) => (
                <label key={f.key} className="block"><span className="label mb-1.5 block">{f.label}{f.required && " *"}</span>
                  <select className="input" value={mapping[f.key] ?? ""} onChange={(e) => { const m = { ...mapping, [f.key]: e.target.value || undefined }; setMapping(m); void check(file, m); }}>
                    <option value="">— not mapped —</option>{file.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {result && counts && (
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn-primary" disabled={busy || !result.products.length} onClick={commit}>Import {counts.toCreate} new / update {counts.toUpdate}</button>
                {result.duplicates > 0 && <span className="text-xs text-warn">{result.duplicates} duplicate SKUs (the last row wins)</span>}
                {result.errors.length > 0 && (
                  <details className="text-sm text-warn"><summary className="cursor-pointer">{result.errors.length} rows will be skipped</summary>
                    <ul className="mt-1 max-h-40 overflow-y-auto text-xs">{result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>
                  </details>
                )}
              </div>
            )}
            {result && result.products.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-hover/60 text-left text-[11px] uppercase tracking-wider text-ink-muted [&_th]:px-3 [&_th]:py-2"><tr><th>SKU</th><th>Name</th><th>Model</th><th>Mfr</th><th className="text-right">Cost</th><th className="text-right">MSRP</th></tr></thead>
                  <tbody className="divide-y divide-line [&_td]:px-3 [&_td]:py-1.5">
                    {result.products.slice(0, 25).map((p) => (
                      <tr key={p.sku}><td className="font-mono text-xs">{p.sku}</td><td>{p.name}</td><td>{p.model}</td><td>{p.manufacturer}</td>
                        <td className="text-right tabular-nums">{fmtMoney(p.costCents)}</td><td className="text-right tabular-nums">{p.msrpCents != null ? fmtMoney(p.msrpCents) : "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-3 py-2 text-xs text-ink-faint">The first {Math.min(25, result.products.length)} of {result.products.length} products.</p>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
