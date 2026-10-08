"use client";
/** Search the vendor price lists by SKU / model / name and add products (to a proposal, kit or budget). */
import { useEffect, useRef, useState } from "react";
import type { CatalogProduct } from "@shared/ops/types";
import { fmtMoney, useOps } from "@/lib/ops";
import { Modal } from "@/components/ui";

export function CatalogPicker({ vendors, onAdd, onClose, title = "Add from vendor price lists", priceOf }: { vendors: { id: string; name: string }[]; onAdd: (p: CatalogProduct, qty: number) => void; onClose: () => void; title?: string; priceOf?: (p: CatalogProduct) => number }) {
  const [q, setQ] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [deb, setDeb] = useState({ q: "", vendorId: "" });
  useEffect(() => { const t = setTimeout(() => setDeb({ q, vendorId }), 200); return () => clearTimeout(t); }, [q, vendorId]);
  const res = useOps<{ products: CatalogProduct[] }>(`/catalog?${new URLSearchParams({ q: deb.q, ...(deb.vendorId ? { vendorId: deb.vendorId } : {}), take: "60" })}`, { placeholderData: (p) => p });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Modal open onClose={onClose} title={title} width={900}>
      <div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row">
        <input ref={ref} className="input flex-1" placeholder="Search SKU, model, or product name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input sm:w-56" value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">All vendors</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        <button className="btn-outline" onClick={onClose}>Done</button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_th]:px-4 [&_th]:py-2"><tr><th>Product</th><th>Vendor</th><th className="text-right">Cost</th><th className="text-right">{priceOf ? "Sells for" : "MSRP"}</th><th className="w-20">Qty</th><th className="w-20" /></tr></thead>
          <tbody className="divide-y divide-line [&_td]:px-4 [&_td]:py-2.5">
            {(res.data?.products ?? []).map((p) => (
              <tr key={p.id} className="hover:bg-hover/40">
                <td><div className="font-medium">{p.name}</div><div className="text-xs text-ink-muted">{[p.manufacturer, p.model, p.sku].filter(Boolean).join(" · ")}</div></td>
                <td className="text-xs">{p.vendor.name}</td>
                <td className="text-right tabular-nums">{fmtMoney(p.costCents)}</td>
                <td className="text-right tabular-nums text-ink-muted">{priceOf ? fmtMoney(priceOf(p)) : p.msrpCents != null ? fmtMoney(p.msrpCents) : "—"}</td>
                <td><input type="number" min={1} className="input py-1" value={qty[p.id] ?? 1} onChange={(e) => setQty({ ...qty, [p.id]: Math.max(1, parseInt(e.target.value) || 1) })} /></td>
                <td><button className="btn-primary py-1" onClick={() => { onAdd(p, qty[p.id] ?? 1); setAdded({ ...added, [p.id]: true }); }}>{added[p.id] ? "Add +" : "Add"}</button></td>
              </tr>
            ))}
            {res.data && !res.data.products.length && <tr><td colSpan={6} className="py-10 text-center text-ink-faint">No products found. Import a vendor price list under Vendors.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}


/** A proposal section from a product category. */
export function guessSection(category: string | null): string | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (/audio|mic|speaker|amp|console|mixer|dsp/.test(c)) return "Audio";
  if (/video|camera|projector|display|led wall|switcher/.test(c)) return "Video";
  if (/light|fixture|dmx|dimmer/.test(c)) return "Lighting";
  if (/rig|truss|mount/.test(c)) return "Rigging";
  if (/cable|connector|snake|network/.test(c)) return "Cable & Connectivity";
  return category;
}
