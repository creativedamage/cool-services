"use client";
/** Kits: saved sets of products, labor and custom lines, added to a proposal or a job budget in one go. */
import { Package, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KitRow } from "@shared/ops/estimating";
import { fmtPct, money0, useOps } from "@/lib/ops";
import { Card, Empty, ErrorBox, Loading, PageHeader, Table } from "@/components/ops/OpsUi";

export default function Kits() {
  const router = useRouter();
  const d = useOps<KitRow[]>("/kits");
  return (
    <>
      <PageHeader crumb="AVL / Pricing" title="Kits"
        description="Rigs you put together again and again, like a stage-left IEM package or a classroom display. Prices follow today's price lists, markup rules and labor rates."
        actions={<Link href="/avl/kits/view?id=new" className="btn-primary"><Plus size={15} /> New kit</Link>} />
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <Card>
          {d.data.length ? (
            <Table min={760} head={<tr><th>Kit</th><th>Section</th><th className="text-right">Lines</th><th className="text-right">Cost</th><th className="text-right">Sells for</th><th className="text-right">Margin</th></tr>}>
              {d.data.map((k) => {
                const m = k.priceCents > 0 ? Math.round(((k.priceCents - k.costCents) / k.priceCents) * 10_000) : 0;
                return (
                  <tr key={k.id} className={k.active ? "cursor-pointer" : "cursor-pointer opacity-50"} onClick={() => router.push(`/avl/kits/view?id=${k.id}`)}>
                    <td><div className="flex items-center gap-2 font-medium"><Package size={14} className="text-ink-faint" />{k.name}{!k.active && <span className="text-[10px] uppercase text-ink-faint">Off</span>}</div>{k.description && <div className="truncate text-[11px] text-ink-faint">{k.description}</div>}</td>
                    <td className="text-ink-soft">{k.section ?? "—"}</td>
                    <td className="text-right tabular-nums">{k.items}</td>
                    <td className="text-right font-mono text-ink-soft">{money0(k.costCents)}</td>
                    <td className="text-right font-mono">{money0(k.priceCents)}</td>
                    <td className="text-right tabular-nums">{k.priceCents ? fmtPct(m) : "—"}</td>
                  </tr>
                );
              })}
            </Table>
          ) : <Empty>No kits yet. Make one from the products and labor you use together most.</Empty>}
        </Card>
      )}
    </>
  );
}
