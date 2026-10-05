"use client";
/** AVL clients: the churches and organizations AVL works for. */
import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { ClientRow } from "@shared/ops/types";
import { fmtDate, money0, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Check, Empty, ErrorBox, Field, Loading, PageHeader, Table } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";

export default function Page() { return <Suspense><Clients /></Suspense>; }

const SHOW = [["active", "Active"], ["inactive", "Inactive"], ["all", "All"]] as const;

function Clients() {
  const sp = useSearchParams();
  const router = useRouter();
  const show = sp.get("show") ?? "active";
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [adding, setAdding] = useState(sp.get("new") === "1");
  const params = new URLSearchParams({ show, ...(sp.get("q") ? { q: sp.get("q")! } : {}) });
  const d = useOps<ClientRow[]>(`/clients?${params}`, { placeholderData: (p) => p });
  const go = (p: Record<string, string>) => {
    const n = new URLSearchParams({ show, q: sp.get("q") ?? "", ...p });
    for (const [k, v] of [...n.entries()]) if (!v || (k === "show" && v === "active")) n.delete(k);
    router.replace(`/avl/clients${n.size ? `?${n}` : ""}`);
  };
  return (
    <>
      <PageHeader crumb="AVL" title="Clients" description="The churches and organizations you quote for, with their contacts and history."
        actions={<button className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> New client</button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {SHOW.map(([k, l]) => (
            <button key={k} onClick={() => go({ show: k })} className={clsx("rounded-md px-3 py-1.5 text-xs font-medium", show === k ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-hover")}>{l}</button>
          ))}
        </div>
        <form className="ml-auto w-full sm:w-auto" onSubmit={(e) => { e.preventDefault(); go({ q }); }}>
          <input className="input sm:w-72" placeholder="Search name, contact, city…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </div>
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <Card>
          {d.data.length ? (
            <Table min={820} head={<tr><th>Client</th><th>Contact</th><th className="text-right">Quotes</th><th className="text-right">Open</th><th className="text-right">Won</th><th>Last quote</th></tr>}>
              {d.data.map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => router.push(`/avl/clients/view?id=${c.id}`)}>
                  <td>
                    <Link href={`/avl/clients/view?id=${c.id}`} className="font-medium hover:text-accent" onClick={(e) => e.stopPropagation()}>{c.name}</Link>
                    <div className="text-[11px] text-ink-faint">{[[c.city, c.state].filter(Boolean).join(", "), !c.active && "inactive", c.taxExempt && "tax exempt"].filter(Boolean).join(" · ") || "\u00a0"}</div>
                  </td>
                  <td><div>{c.contactName ?? <span className="text-ink-faint">—</span>}</div><div className="text-[11px] text-ink-faint">{c.email ?? c.phone ?? ""}</div></td>
                  <td className="text-right font-mono text-ink-soft">{c.quotes}</td>
                  <td className="text-right font-mono">{c.openCents ? money0(c.openCents) : "—"}</td>
                  <td className="text-right font-mono text-ok">{c.wonCents ? money0(c.wonCents) : "—"}</td>
                  <td className="text-xs text-ink-muted">{c.lastQuoteAt ? fmtDate(c.lastQuoteAt) : "—"}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>{sp.get("q") ? "No clients match." : "No clients yet. Add the first church you're quoting for."}</Empty>}
        </Card>
      )}
      {adding && <NewClient onClose={() => setAdding(false)} />}
    </>
  );
}

function NewClient({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const [f, setF] = useState({ name: "", city: "", state: "", phone: "", website: "", taxExempt: true, contactName: "", contactTitle: "", contactEmail: "", contactPhone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <Modal open onClose={onClose} title="New client" width={560}>
      <form className="space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          const c = await ops<{ id: string }>("/clients", { json: {
            name: f.name, city: f.city, state: f.state, phone: f.phone, website: f.website, taxExempt: f.taxExempt,
            contact: f.contactName ? { name: f.contactName, title: f.contactTitle, email: f.contactEmail, phone: f.contactPhone } : null,
          } });
          void refresh();
          router.push(`/avl/clients/view?id=${c.id}`);
        } catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <Field label="Church or organization"><input required autoFocus className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Grace Fellowship" /></Field>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="City"><input className="input" value={f.city} onChange={(e) => set({ city: e.target.value })} /></Field>
          <Field label="State"><input className="input" value={f.state} onChange={(e) => set({ state: e.target.value })} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Main phone"><input className="input" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Website"><input className="input" value={f.website} onChange={(e) => set({ website: e.target.value })} placeholder="grace.org" /></Field>
        </div>
        <Check label="Tax exempt" hint="Most churches are. Their quotes won't add sales tax." checked={f.taxExempt} onChange={(v) => set({ taxExempt: v })} />
        <div className="space-y-3 rounded-lg border border-line bg-canvas/50 p-3">
          <span className="label block">Main contact</span>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" placeholder="Name" value={f.contactName} onChange={(e) => set({ contactName: e.target.value })} />
            <input className="input" placeholder="Title (e.g. Technical director)" value={f.contactTitle} onChange={(e) => set({ contactTitle: e.target.value })} />
            <input type="email" className="input" placeholder="Email" value={f.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} />
            <input className="input" placeholder="Phone" value={f.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} />
          </div>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy && <Spinner />}Add client</button>
        </div>
      </form>
    </Modal>
  );
}
