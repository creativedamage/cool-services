"use client";
/**
 * A proposal as the client gets it (printed, as a PDF, or on the proposal link): letterhead, scope
 * by section, totals and terms. Never cost, margin or internal notes.
 */
import type { PrintData, PublicQuote } from "@shared/ops/types";
import { fmtMoney } from "@/lib/ops";

export function ProposalDoc({ data: { quote, org, logo }, signature }: { data: PrintData; signature?: React.ReactNode }) {
  const addr = [org.addressLine1, org.addressLine2, [org.city, org.state, org.postalCode].filter(Boolean).join(", ")].filter(Boolean);
  return (
    <article>
      <header className="flex flex-col gap-6 border-b border-[#e2e8f0] pb-6 sm:flex-row sm:justify-between">
        <div>
          {logo ? <img src={logo} alt={org.name ?? ""} className="mb-3 h-12 w-auto max-w-[220px] object-contain" />
            : <div className="mb-2 text-xl font-semibold text-[#0b6bcb]">{org.name}</div>}
          <div className="text-sm leading-5 text-[#475569]">
            {addr.map((l) => <div key={l}>{l}</div>)}
            {org.phone && <div>{org.phone}</div>}{org.email && <div>{org.email}</div>}{org.ein && <div>EIN {org.ein}</div>}
          </div>
        </div>
        <div className="sm:text-right">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">Proposal</div>
          <div className="font-mono text-lg">{quote.number}</div>
          <div className="mt-2 text-sm text-[#475569]">
            <div>Date: {new Date(quote.sentAt ?? quote.createdAt).toLocaleDateString()}</div>
            {quote.validUntil && <div>Valid until: {new Date(quote.validUntil).toLocaleDateString()}</div>}
          </div>
          <div className="mt-3 text-sm">
            <div className="text-xs font-semibold uppercase text-[#94a3b8]">Prepared for</div>
            <div className="font-medium">{quote.customer.name}</div>
            {quote.customer.contactName && <div>{quote.customer.contactName}</div>}
          </div>
        </div>
      </header>
      <h1 className="mt-6 text-2xl font-semibold">{quote.title}</h1>
      {quote.introNotes && <p className="mt-2 whitespace-pre-wrap text-[#475569]">{quote.introNotes}</p>}
      <div className="mt-6 space-y-6">
        {groupBySection(quote.items).map(([section, items]) => (
          <section key={section} className="break-inside-avoid">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#0b6bcb]">{section}</h2>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#e2e8f0] text-left text-[10px] uppercase tracking-wider text-[#94a3b8]"><th className="py-2">Item</th><th className="w-16 py-2 text-right">Qty</th><th className="w-28 py-2 text-right">Unit</th><th className="w-28 py-2 text-right">Amount</th></tr></thead>
              <tbody className="divide-y divide-[#e2e8f0]">
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2"><div className="font-medium">{i.name}</div>{i.description && <div className="text-xs text-[#64748b]">{i.description}</div>}</td>
                    <td className="py-2 text-right tabular-nums">{i.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{fmtMoney(i.unitPriceCents)}</td>
                    <td className="py-2 text-right tabular-nums">{fmtMoney(i.quantity * i.unitPriceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <div className="mt-8 flex justify-end">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <T l="Subtotal" v={fmtMoney(quote.totals.subtotalCents)} />
          {quote.totals.discountCents > 0 && <T l="Discount" v={`−${fmtMoney(quote.totals.discountCents)}`} />}
          <T l="Tax" v={fmtMoney(quote.totals.taxCents)} />
          <div className="border-t border-[#e2e8f0] pt-1 text-base font-semibold"><T l="Total" v={fmtMoney(quote.totals.totalCents)} /></div>
          {quote.totals.depositCents > 0 && <T l="Due at approval" v={fmtMoney(quote.totals.depositCents)} />}
        </dl>
      </div>
      {quote.terms && (
        <section className="mt-8 break-inside-avoid border-t border-[#e2e8f0] pt-4">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">Terms &amp; conditions</h2>
          <p className="whitespace-pre-wrap text-xs leading-5 text-[#475569]">{quote.terms}</p>
        </section>
      )}
      {signature !== undefined ? signature : (
        <section className="mt-10 grid break-inside-avoid grid-cols-2 gap-10 text-sm">
          {["Accepted by (signature)", "Date"].map((l) => <div key={l}><div className="h-10 border-b border-[#94a3b8]" /><div className="mt-1 text-xs text-[#64748b]">{l}</div></div>)}
        </section>
      )}
    </article>
  );
}

const T = ({ l, v }: { l: string; v: string }) => <div className="flex justify-between"><dt className="text-[#64748b]">{l}</dt><dd className="tabular-nums">{v}</dd></div>;
function groupBySection(items: PublicQuote["items"]): [string, PublicQuote["items"]][] {
  const m = new Map<string, PublicQuote["items"]>();
  for (const i of items) { const k = i.section || "Items"; m.set(k, [...(m.get(k) ?? []), i]); }
  return [...m.entries()];
}
