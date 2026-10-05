"use client";
/** Product pricing: every vendor price list, by SKU, model or name. */
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import type { CatalogProduct } from "@shared/ops/types";
import { fmtMoney, useOps } from "@/lib/ops";
import { Plus } from "lucide-react";
import { Card, ErrorBox, Loading, PageHeader, Table } from "@/components/ops/OpsUi";
import { ProductDialog } from "@/components/ops/ProductForm";

export default function Page() { return <Suspense><Catalog /></Suspense>; }

function Catalog() {
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [vendorId, setVendorId] = useState(sp.get("vendorId") ?? "");
  const params = new URLSearchParams({ q: sp.get("q") ?? "", ...(sp.get("vendorId") ? { vendorId: sp.get("vendorId")! } : {}), take: "200" });
  const d = useOps<{ vendors: { id: string; name: string }[]; products: CatalogProduct[] }>(`/catalog?${params}`, { placeholderData: (p) => p });
  const [editing, setEditing] = useState<CatalogProduct | "new" | null>(null);
  const search = (e?: React.FormEvent, v = vendorId) => { e?.preventDefault(); router.replace(`/avl/catalog?${new URLSearchParams({ ...(q ? { q } : {}), ...(v ? { vendorId: v } : {}) })}`); };
  return (
    <>
      <PageHeader crumb="AVL" title="Product pricing" description="Search every vendor price list by SKU, model or name. Click a product to change it."
        actions={<button className="btn-primary" onClick={() => setEditing("new")} disabled={!d.data?.vendors.length}><Plus size={15} /> Add product</button>} />
      <ProductDialog open={editing !== null} onClose={() => setEditing(null)} vendors={d.data?.vendors ?? []}
        vendorId={editing === "new" ? sp.get("vendorId") ?? undefined : undefined} product={editing === "new" ? null : editing} />
      <form className="mb-4 flex flex-col gap-2 sm:flex-row" onSubmit={search}>
        <input autoFocus className="input flex-1" placeholder="Search SKU, model, or product name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input sm:w-64" value={vendorId} onChange={(e) => { setVendorId(e.target.value); search(undefined, e.target.value); }}>
          <option value="">All vendors</option>{d.data?.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <button className="btn-primary">Search</button>
      </form>
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <Card>
          <Table min={860} head={<tr><th>SKU</th><th>Product</th><th>Model</th><th>Vendor</th><th className="text-right">Cost</th><th className="text-right">MSRP</th><th className="text-right">MAP</th><th>Updated</th></tr>}>
            {d.data.products.map((p) => (
              <tr key={p.id} className="cursor-pointer" onClick={() => setEditing(p)}>
                <td className="font-mono text-xs text-ink-muted">{p.sku}</td>
                <td><div className="font-medium">{p.name}</div><div className="text-xs text-ink-faint">{p.manufacturer} {p.category && `· ${p.category}`}</div></td>
                <td>{p.model}</td><td>{p.vendor.name}</td>
                <td className="text-right tabular-nums">{fmtMoney(p.costCents)}</td>
                <td className="text-right tabular-nums">{p.msrpCents != null ? fmtMoney(p.msrpCents) : "—"}</td>
                <td className="text-right tabular-nums">{p.mapCents != null ? fmtMoney(p.mapCents) : "—"}</td>
                <td className="text-xs text-ink-faint">{new Date(p.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {!d.data.products.length && <tr><td colSpan={8} className="py-12 text-center text-ink-faint">No products match. Add one, or import a vendor price list under Vendors.</td></tr>}
          </Table>
        </Card>
      )}
    </>
  );
}
