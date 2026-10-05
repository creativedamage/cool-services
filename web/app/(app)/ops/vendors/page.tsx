"use client";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { VendorRow } from "@shared/ops/types";
import { useOps } from "@/lib/ops";
import { Card, Empty, ErrorBox, Loading, PageHeader, Table } from "@/components/ops/OpsUi";
import { VendorForm } from "@/components/ops/VendorForm";

export default function Vendors() {
  const d = useOps<VendorRow[]>("/vendors");
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader crumb="AVL" title="Vendors" description="Vendor directory and price-list imports." actions={<button className="btn-primary" onClick={() => setAdding(!adding)}><Plus size={15} /> Add vendor</button>} />
      {adding && <Card title="New vendor" className="mb-5"><VendorForm /></Card>}
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <Card>
          {d.data.length ? (
            <Table min={640} head={<tr><th>Vendor</th><th>Rep</th><th>Terms</th><th className="text-right">Products</th></tr>}>
              {d.data.map((v) => (
                <tr key={v.id}>
                  <td><Link className="font-medium text-accent hover:underline" href={`/ops/vendors/view?id=${v.id}`}>{v.name}</Link>{!v.active && <span className="ml-2 text-xs text-ink-faint">inactive</span>}</td>
                  <td>{v.repName}<div className="text-xs text-ink-faint">{v.repEmail}</div></td>
                  <td>{v.terms}</td>
                  <td className="text-right tabular-nums">{v.productCount}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No vendors yet. Add one, then import its price list.</Empty>}
        </Card>
      )}
    </>
  );
}
