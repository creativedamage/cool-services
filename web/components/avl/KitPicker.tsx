"use client";
import { Package } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { KitLine, KitRow } from "@shared/ops/estimating";
import { fmtMoney, ops } from "@/lib/ops";
import { Modal, Spinner } from "@/components/ui";

/** Pick a kit and add its lines (priced today), or the whole kit as one line. */
export function KitPicker({ kits, onAdd, onClose, allowOne = true }: { kits: KitRow[]; onAdd: (k: KitRow, lines: KitLine[], asOne: boolean) => void; onClose: () => void; allowOne?: boolean }) {
  const [asOne, setAsOne] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const shown = kits.filter((k) => !q || `${k.name} ${k.section ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal open onClose={onClose} title="Add a kit" width={640}>
      <div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row sm:items-center">
        <input autoFocus className="input flex-1" placeholder="Search kits…" value={q} onChange={(e) => setQ(e.target.value)} />
        {allowOne && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={asOne} onChange={(e) => setAsOne(e.target.checked)} /> As one line</label>}
      </div>
      <ul className="max-h-[55vh] divide-y divide-line overflow-y-auto">
        {shown.map((k) => (
          <li key={k.id} className="flex items-center gap-3 px-4 py-3">
            <Package size={16} className="shrink-0 text-ink-faint" />
            <div className="min-w-0 flex-1"><div className="font-medium">{k.name}</div><div className="text-xs text-ink-muted">{[k.section, `${k.items} lines`].filter(Boolean).join(" · ")}</div></div>
            <span className="tabular-nums">{fmtMoney(k.priceCents)}</span>
            <button className="btn-primary py-1" disabled={!!busy} onClick={async () => {
              setBusy(k.id);
              try { const r = await ops<{ lines: KitLine[] }>(`/kits/${k.id}/lines`); onAdd(k, r.lines, asOne); onClose(); }
              catch (e) { toast.error((e as Error).message); setBusy(null); }
            }}>{busy === k.id ? <Spinner /> : "Add"}</button>
          </li>
        ))}
        {!shown.length && <li className="px-4 py-10 text-center text-sm text-ink-faint">{kits.length ? "No kits match." : <>No kits yet. <Link href="/avl/kits/view?id=new" className="text-accent hover:underline">Make one</Link> from the products and labor you use together.</>}</li>}
      </ul>
      <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">Lines come in at today's price list, markup rules and labor rates. As one line, the client sees just the kit and its total.</p>
    </Modal>
  );
}

