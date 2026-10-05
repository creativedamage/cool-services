"use client";
/** Add one product to a vendor by hand, or change / remove one (no spreadsheet needed). */
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { CatalogProduct } from "@shared/ops/types";
import { ops, useOpsRefresh } from "@/lib/ops";
import { Modal, Spinner } from "@/components/ui";
import { Field, MoneyInput } from "./OpsUi";

type Form = { vendorId: string; sku: string; name: string; model: string; manufacturer: string; category: string; description: string; costCents: number | null; msrpCents: number | null; mapCents: number | null };

export function ProductDialog({ open, onClose, vendors, vendorId, product }: {
  open: boolean; onClose: () => void; vendors: { id: string; name: string }[]; vendorId?: string; product?: CatalogProduct | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title={product ? "Edit product" : "Add a product"} width={640}>
      {open && <ProductForm key={product?.id ?? "new"} vendors={vendors} vendorId={vendorId} product={product ?? null} onDone={onClose} />}
    </Modal>
  );
}

function ProductForm({ vendors, vendorId, product, onDone }: { vendors: { id: string; name: string }[]; vendorId?: string; product: CatalogProduct | null; onDone: () => void }) {
  const refresh = useOpsRefresh();
  const [f, setF] = useState<Form>(product ? {
    vendorId: product.vendor.id, sku: product.sku, name: product.name, model: product.model ?? "", manufacturer: product.manufacturer ?? "", category: product.category ?? "",
    description: product.description ?? "", costCents: product.costCents, msrpCents: product.msrpCents, mapCents: product.mapCents,
  } : { vendorId: vendorId ?? vendors[0]?.id ?? "", sku: "", name: "", model: "", manufacturer: "", category: "", description: "", costCents: null, msrpCents: null, mapCents: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Form>) => setF({ ...f, ...p });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (f.costCents == null) return setError("Enter the cost.");
    setBusy(true); setError(null);
    const { vendorId: v, ...body } = f;
    try {
      if (product) await ops(`/products/${product.id}`, { method: "PUT", json: body });
      else await ops(`/vendors/${v}/products`, { json: body });
      toast.success(product ? "Product saved" : `Added ${f.name}`);
      await refresh(); onDone();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!product || !confirm(`Remove ${product.name} from product pricing? Quotes that already use it keep their line.`)) return;
    setBusy(true);
    try { await ops(`/products/${product.id}`, { method: "DELETE" }); toast.success("Product removed"); await refresh(); onDone(); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <form onSubmit={save} className="space-y-4 p-5">
      {!product && !vendorId && (
        <Field label="Vendor">
          <select required className="input" value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })}>
            {!vendors.length && <option value="">Add a vendor first</option>}
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Field label="SKU / Part #"><input required autoFocus={!product} className="input font-mono" value={f.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="e.g. QLXD24/SM58-G50" /></Field>
        <Field label="Product name"><input required className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Wireless handheld system" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Manufacturer"><input className="input" value={f.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} placeholder="e.g. Shure" /></Field>
        <Field label="Model"><input className="input" value={f.model} onChange={(e) => set({ model: e.target.value })} /></Field>
        <Field label="Category"><input className="input" value={f.category} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. Wireless" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Cost"><MoneyInput nullable cents={f.costCents} onChange={(c) => set({ costCents: c })} placeholder="0.00" /></Field>
        <Field label="MSRP" hint="Optional"><MoneyInput nullable cents={f.msrpCents} onChange={(c) => set({ msrpCents: c })} /></Field>
        <Field label="MAP" hint="Optional"><MoneyInput nullable cents={f.mapCents} onChange={(c) => set({ mapCents: c })} /></Field>
      </div>
      <Field label="Description"><textarea className="input min-h-[72px]" value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="flex items-center gap-2">
        <button className="btn-primary" disabled={busy}>{busy && <Spinner />}{product ? "Save" : "Add product"}</button>
        <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
        {product && <button type="button" className="btn-ghost ml-auto text-bad" onClick={remove} disabled={busy}><Trash2 size={14} /> Remove</button>}
      </div>
    </form>
  );
}
