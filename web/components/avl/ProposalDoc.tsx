"use client";
/**
 * A proposal as the client gets it (printed, as a PDF, or on the proposal link): letterhead, scope
 * by section, totals and terms. Never cost, margin or internal notes.
 */
import type { PrintData, PublicQuote } from "@shared/ops/types";
import { applySelections, isOption, optionGroups, PACKAGE_GROUP, packageLabel, selectionsOf } from "@shared/ops/estimating";
import { computeTotals } from "@shared/ops/math";
import { fmtMoney } from "@/lib/ops";

/** On the client's page the options can be chosen; printed, they show what's chosen. */
export interface Chooser { addOn: (group: string, on: boolean) => void; pick: (group: string, choice: string) => void }

export function ProposalDoc({ data: { quote, org, logo }, signature, chooser }: { data: PrintData; signature?: React.ReactNode; chooser?: Chooser }) {
  const all = optionGroups(quote.items);
  const pkg = all.find((g) => g.group === PACKAGE_GROUP && g.kind === "ALTERNATES") ?? null;
  const groups = all.filter((g) => g !== pkg);
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
          <div className="font-mono text-lg">{quote.number}{quote.version > 1 && <span className="ml-1 text-sm text-[#94a3b8]">v{quote.version}</span>}</div>
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
      {pkg && <Packages quote={quote} group={pkg} chooser={chooser} />}
      <div className="mt-6 space-y-6">
        {pkg && quote.items.some((i) => !isOption(i)) && <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">{pkg.choices.length > 1 ? "Included with every option" : "Also included"}</h2>}
        {groupBySection(quote.items.filter((i) => !isOption(i))).map(([section, items]) => (
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
      {groups.length > 0 && (
        <div className="mt-8 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#0b6bcb]">{pkg ? "Add-ons" : "Options"}{chooser ? ": choose what you'd like" : ""}</h2>
          {groups.map((g) => (
            <section key={g.group} className="break-inside-avoid rounded-lg border border-[#e2e8f0] p-3">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <div className="font-semibold">{g.group}</div>
                <div className="text-xs text-[#64748b]">{g.kind === "ADD_ON" ? "Optional" : "Choose one"}</div>
              </div>
              <div className="space-y-2">
                {g.choices.map((c) => {
                  const amount = c.items.reduce((t, i) => t + i.quantity * i.unitPriceCents, 0);
                  const control = g.kind === "ADD_ON"
                    ? <input type="checkbox" className="mt-1 h-4 w-4 accent-[#0f766e]" checked={c.selected} disabled={!chooser} onChange={(e) => chooser?.addOn(g.group, e.target.checked)} />
                    : <input type="radio" name={`opt-${g.group}`} className="mt-1 h-4 w-4 accent-[#0f766e]" checked={c.selected} disabled={!chooser} onChange={() => chooser?.pick(g.group, c.choice!)} />;
                  return (
                    <label key={c.choice ?? "addon"} className={`flex gap-3 rounded-md p-2 ${c.selected ? "bg-[#f0fdfa] ring-1 ring-[#99f6e4]" : "bg-[#f8fafc]"} ${chooser ? "cursor-pointer" : ""}`}>
                      <span className="no-print">{control}</span>
                      <span className="print-only w-4 shrink-0 pt-0.5 text-[#0f766e]">{c.selected ? "✓" : ""}</span>
                      <span className="min-w-0 flex-1">
                        {c.choice && <span className="block font-medium">{c.choice}</span>}
                        {c.items.map((i) => (
                          <span key={i.id} className="block text-sm text-[#334155]">{i.quantity > 1 ? `${i.quantity} × ` : ""}{i.name}{i.description && <span className="block text-xs text-[#64748b]">{i.description}</span>}</span>
                        ))}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block tabular-nums">{g.kind === "ADD_ON" ? "+" : ""}{fmtMoney(amount)}</span>
                        <span className={`block text-[11px] ${c.selected ? "text-[#0f766e]" : "text-[#94a3b8]"}`}>{c.selected ? (g.kind === "ADD_ON" ? "Included" : "Chosen") : "Not included"}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
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

/** Option A, B, C…: side by side, each with what's in it and the proposal's total if it's the one. */
function Packages({ quote, group, chooser }: { quote: PublicQuote; group: ReturnType<typeof optionGroups<PublicQuote["items"][number]>>[number]; chooser?: Chooser }) {
  const base = selectionsOf(quote.items);
  const totalWith = (choice: string) => computeTotals(applySelections(quote.items, { ...base, [PACKAGE_GROUP]: choice }).map((i) => ({ ...i, unitCostCents: 0 })), quote.pricing).totalCents;
  const one = group.choices.length === 1;
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#0b6bcb]">{one ? "Your option" : chooser ? "Choose your option" : "Options"}</h2>
      <div className={`grid gap-3 ${one ? "" : group.choices.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {group.choices.map((c) => {
          const amount = c.items.reduce((t, i) => t + i.quantity * i.unitPriceCents, 0);
          return (
            <label key={c.choice} className={`flex flex-col rounded-xl border-2 p-4 ${c.selected ? "border-[#0f766e] bg-[#f0fdfa]" : "border-[#e2e8f0] bg-white"} ${chooser && !one ? "cursor-pointer hover:border-[#5eead4]" : ""}`}>
              <span className="flex items-center gap-2">
                {chooser && !one && <input type="radio" name="opt-package" className="no-print h-4 w-4 accent-[#0f766e]" checked={c.selected} onChange={() => chooser.pick(group.group, c.choice!)} />}
                <span className="text-lg font-semibold">{packageLabel(c.choice)}</span>
                {c.selected && <span className="ml-auto rounded-full bg-[#0f766e] px-2 py-0.5 text-[11px] font-semibold text-white">{one ? "Chosen" : chooser ? "Selected" : "Chosen"}</span>}
              </span>
              <span className="mt-2 flex-1 space-y-1.5">
                {c.items.map((i) => (
                  <span key={i.id} className="block text-sm text-[#334155]">
                    <span className="flex justify-between gap-2"><span>{i.quantity > 1 ? `${i.quantity} × ` : ""}{i.name}</span><span className="shrink-0 tabular-nums text-[#64748b]">{fmtMoney(i.quantity * i.unitPriceCents)}</span></span>
                    {i.description && <span className="block text-xs text-[#64748b]">{i.description}</span>}
                  </span>
                ))}
              </span>
              <span className="mt-3 block border-t border-[#e2e8f0] pt-2 text-sm">
                <span className="flex justify-between"><span className="text-[#64748b]">This option</span><span className="tabular-nums">{fmtMoney(amount)}</span></span>
                {!one && <span className="flex justify-between font-semibold"><span>Proposal total</span><span className="tabular-nums">{fmtMoney(totalWith(c.choice!))}</span></span>}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

const T = ({ l, v }: { l: string; v: string }) => <div className="flex justify-between"><dt className="text-[#64748b]">{l}</dt><dd className="tabular-nums">{v}</dd></div>;
function groupBySection(items: PublicQuote["items"]): [string, PublicQuote["items"]][] {
  const m = new Map<string, PublicQuote["items"]>();
  for (const i of items) { const k = i.section || "Items"; m.set(k, [...(m.get(k) ?? []), i]); }
  return [...m.entries()];
}
