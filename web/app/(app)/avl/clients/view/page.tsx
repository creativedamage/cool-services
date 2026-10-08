"use client";
/** One client: their details, contacts and every quote. */
import { ActivityFeed } from "@/components/avl/ActivityFeed";
import clsx from "clsx";
import { Mail, Pencil, Phone, Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import type { ClientContact, ClientDetail, ClientPage } from "@shared/ops/types";
import { fmtDate, fmtMoney, money0, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Check, Empty, ErrorBox, Field, KpiRow, Loading, PageHeader, QuoteStatusBadge, Table } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";

export default function Page() { return <Suspense><Client /></Suspense>; }

function Client() {
  const id = useSearchParams().get("id") ?? "";
  const d = useOps<ClientPage>(id ? `/clients/${id}` : null);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const { client: c, contacts, quotes, totals } = d.data;
  const where = [c.city, c.state].filter(Boolean).join(", ");
  return (
    <>
      <PageHeader crumb="AVL / Clients" title={c.name}
        description={<span className="flex flex-wrap gap-x-3">{where && <span>{where}</span>}{c.taxExempt && <span className="text-ok">Tax exempt</span>}{!c.active && <span className="text-warn">Inactive</span>}</span>}
        actions={<>
          <Link href={`/avl/leads?new=1&client=${c.id}`} className="btn-outline"><Plus size={15} /> New lead</Link>
          <Link href={`/avl/quotes?new=1&client=${c.id}`} className="btn-primary"><Plus size={15} /> New quote</Link>
        </>} />
      <div className="space-y-5">
        <KpiRow items={[
          { value: String(quotes.length), label: "Quotes" },
          { value: money0(totals.openCents), label: "Open pipeline" },
          { value: money0(totals.wonCents), label: "Won", tone: "ok" },
        ]} />
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-5">
            <Card eyebrow="Quotes" title="Every quote for this client">
              {quotes.length ? (
                <Table min={620} head={<tr><th>Quote</th><th>Issued</th><th className="text-right">Total</th><th>Status</th></tr>}>
                  {quotes.map((q) => (
                    <tr key={q.id}>
                      <td><Link href={`/avl/quotes/view?id=${q.id}`} className="font-medium hover:text-accent">{q.title}</Link><div className="font-mono text-[11px] text-ink-faint">{q.number}</div></td>
                      <td className="text-ink-soft">{fmtDate(q.sentAt ?? q.createdAt)}</td>
                      <td className="text-right font-mono">{fmtMoney(q.totalCents)}</td>
                      <td><QuoteStatusBadge status={q.status} /></td>
                    </tr>
                  ))}
                </Table>
              ) : <Empty>No quotes yet.</Empty>}
            </Card>
            <ActivityFeed target={{ customerId: c.id }} title="Notes & follow-ups" eyebrow="Activity" showContext compact />
            <Details key={JSON.stringify(c)} c={c} />
          </div>
          <Contacts clientId={c.id} contacts={contacts} />
        </div>
      </div>
    </>
  );
}

function Details({ c }: { c: ClientDetail }) {
  const refresh = useOpsRefresh();
  const [f, setF] = useState(c);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<ClientDetail>) => setF({ ...f, ...p });
  const text = (k: keyof ClientDetail, label: string, cls?: string, ph?: string) => (
    <Field label={label} className={cls}><input className="input" value={(f[k] as string | null) ?? ""} placeholder={ph} onChange={(e) => set({ [k]: e.target.value || null } as Partial<ClientDetail>)} /></Field>
  );
  return (
    <Card eyebrow="Client" title="Details">
      <form className="grid gap-4 p-4 sm:grid-cols-6" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try {
          await ops(`/clients/${c.id}`, { method: "PUT", json: { name: f.name, website: f.website, phone: f.phone, email: f.email, addressLine1: f.addressLine1, addressLine2: f.addressLine2,
            city: f.city, state: f.state, postalCode: f.postalCode, taxExempt: f.taxExempt, notes: f.notes, active: f.active } });
          toast.success("Saved"); await refresh();
        } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
      }}>
        <Field label="Name" className="sm:col-span-4"><input required className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        {text("phone", "Main phone", "sm:col-span-2")}
        {text("website", "Website", "sm:col-span-3")}
        {text("email", "Billing email", "sm:col-span-3")}
        {text("addressLine1", "Address", "sm:col-span-4")}
        {text("addressLine2", "Suite / building", "sm:col-span-2")}
        {text("city", "City", "sm:col-span-3")}
        {text("state", "State", "sm:col-span-1")}
        {text("postalCode", "ZIP", "sm:col-span-2")}
        <Field label="Notes (only your team sees these)" className="sm:col-span-6"><textarea rows={3} className="input" value={f.notes ?? ""} onChange={(e) => set({ notes: e.target.value || null })} /></Field>
        <div className="flex flex-wrap gap-6 sm:col-span-6">
          <Check label="Tax exempt" checked={f.taxExempt} onChange={(v) => set({ taxExempt: v })} />
          <Check label="Active client" checked={f.active} onChange={(v) => set({ active: v })} />
        </div>
        <div className="sm:col-span-6"><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save</button></div>
      </form>
    </Card>
  );
}

const blank = { name: "", title: "", email: "", phone: "", isPrimary: false };

function Contacts({ clientId, contacts }: { clientId: string; contacts: ClientContact[] }) {
  const refresh = useOpsRefresh();
  const [editing, setEditing] = useState<string | "new" | null>(contacts.length ? null : "new");
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); await refresh(); setEditing(null); } catch (err) { toast.error((err as Error).message); } };
  return (
    <Card eyebrow="People" title="Contacts" action={editing !== "new" && <button className="btn-ghost text-xs" onClick={() => setEditing("new")}><Plus size={13} /> Add</button>}>
      <ul className="divide-y divide-line">
        {contacts.map((ct) => editing === ct.id ? (
          <li key={ct.id} className="p-4"><ContactForm initial={{ ...blank, ...ct, title: ct.title ?? "", email: ct.email ?? "", phone: ct.phone ?? "" }} onCancel={() => setEditing(null)}
            onSave={(v) => run(() => ops(`/contacts/${ct.id}`, { method: "PUT", json: v }), "Contact saved")} /></li>
        ) : (
          <li key={ct.id} className="group flex items-start gap-3 px-4 py-3">
            <span className={clsx("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold", ct.isPrimary ? "bg-accent text-on-accent" : "bg-hover text-ink-soft")}>
              {ct.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium">{ct.name}{ct.isPrimary && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-accent">Main</span>}</div>
              {ct.title && <div className="text-xs text-ink-muted">{ct.title}</div>}
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                {ct.email && <a href={`mailto:${ct.email}`} className="inline-flex items-center gap-1 text-accent hover:underline"><Mail size={11} />{ct.email}</a>}
                {ct.phone && <a href={`tel:${ct.phone}`} className="inline-flex items-center gap-1 text-ink-soft hover:text-ink"><Phone size={11} />{ct.phone}</a>}
              </div>
            </div>
            <div className="flex gap-0.5 opacity-60 transition group-hover:opacity-100">
              {!ct.isPrimary && <button title="Make main contact" className="btn-ghost p-1.5" onClick={() => run(() => ops(`/contacts/${ct.id}`, { method: "PUT", json: { ...ct, isPrimary: true } }), `${ct.name} is the main contact`)}><Star size={13} /></button>}
              <button title="Edit" className="btn-ghost p-1.5" onClick={() => setEditing(ct.id)}><Pencil size={13} /></button>
              <button title="Remove" className="btn-ghost p-1.5 text-bad" onClick={() => confirm(`Remove ${ct.name}?`) && run(() => ops(`/contacts/${ct.id}`, { method: "DELETE" }), "Contact removed")}><Trash2 size={13} /></button>
            </div>
          </li>
        ))}
        {editing === "new" && (
          <li className="p-4"><ContactForm initial={{ ...blank, isPrimary: !contacts.length }} onCancel={contacts.length ? () => setEditing(null) : undefined}
            onSave={(v) => run(() => ops(`/clients/${clientId}/contacts`, { json: v }), "Contact added")} /></li>
        )}
      </ul>
    </Card>
  );
}

function ContactForm({ initial, onSave, onCancel }: { initial: typeof blank; onSave: (v: typeof blank) => Promise<void>; onCancel?: () => void }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSave(f); setBusy(false); }}>
      <input required autoFocus className="input" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="input" placeholder="Title (e.g. Worship pastor)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <div className="grid gap-2 sm:grid-cols-2">
        <input type="email" className="input" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className="input" placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </div>
      <Check label="Main contact (shown on proposals)" checked={f.isPrimary} onChange={(v) => setF({ ...f, isPrimary: v })} />
      <div className="flex gap-2 pt-1">
        <button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save contact</button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
