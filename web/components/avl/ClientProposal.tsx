"use client";
/**
 * The client's proposal page (sundays-ops.vercel.app/proposal?t=…): no sign-in, the link is the key.
 * They read the proposal and sign it (drawn or typed signature), ask for changes, or decline. Made
 * for a phone as much as a desk; Print saves a PDF.
 */
import clsx from "clsx";
import { CheckCircle2, MessageSquareText, PenLine, Printer, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { applySelections, optionGroups, selectionsOf, type Selections } from "@shared/ops/estimating";
import { computeTotals } from "@shared/ops/math";
import type { PublicQuote } from "@shared/ops/types";
import type { ClientProposalPage } from "@shared/ops/jobs";
import { fmtMoney, OpsError, opsPublic } from "@/lib/ops";
import { ProposalDoc, type Chooser } from "./ProposalDoc";
import { Banner, input, label, Sheet, Shell, SignForm, when } from "./Signing";

type Load = { page: ClientProposalPage } | { error: string; draft?: boolean } | null;

export function ClientProposal({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>(null);
  const [sheet, setSheet] = useState<"sign" | "changes" | "decline" | null>(null);
  const [sel, setSel] = useState<Selections>({});
  const pageQuote = load && "page" in load ? load.page.quote : null;
  useEffect(() => { if (pageQuote) setSel(selectionsOf(pageQuote.items)); }, [pageQuote]);
  // The client's choices: which options are in, and the total that follows.
  const shown = useMemo<PublicQuote | null>(() => {
    if (!pageQuote || !(load && "page" in load && load.page.canAnswer) || !optionGroups(pageQuote.items).length) return pageQuote;
    const items = applySelections(pageQuote.items, sel);
    const t = computeTotals(items.map((i) => ({ ...i, unitCostCents: 0 })), pageQuote.pricing);
    return { ...pageQuote, items, totals: { subtotalCents: t.subtotalCents, discountCents: t.discountCents, taxCents: t.taxCents, totalCents: t.totalCents, depositCents: t.depositCents } };
  }, [pageQuote, sel, load]);
  const fetchPage = useCallback(async () => {
    if (!token) return setLoad({ error: "This link is missing part of its address. Open it again from the email." });
    try { setLoad({ page: await opsPublic<ClientProposalPage>(`/public/proposals/${encodeURIComponent(token)}`) }); }
    catch (e) { setLoad({ error: (e as Error).message, draft: e instanceof OpsError && e.body.status === "draft" }); }
  }, [token]);
  useEffect(() => { void fetchPage(); }, [fetchPage]);

  if (!load) return <Shell><div className="py-24 text-center text-[#64748b]">Loading the proposal…</div></Shell>;
  if ("error" in load) {
    return (
      <Shell>
        <div className="mx-auto max-w-md py-24 text-center">
          <div className="text-lg font-semibold text-[#0f172a]">{load.draft ? "This proposal is being updated" : "We can’t open this proposal"}</div>
          <p className="mt-2 text-[#475569]">{load.error}</p>
        </div>
      </Shell>
    );
  }
  const p = load.page;
  const { org } = p;
  const quote = shown ?? p.quote;
  const chooser: Chooser | undefined = p.canAnswer ? { addOn: (g, on) => setSel((x) => ({ ...x, [g]: on })), pick: (g, c) => setSel((x) => ({ ...x, [g]: c })) } : undefined;
  const done = quote.status === "ACCEPTED" || quote.status === "CONVERTED";
  const answered = (page: ClientProposalPage) => { setLoad({ page }); setSheet(null); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return (
    <Shell>
      <div className="no-print sticky top-0 z-20 border-b border-[#e2e8f0] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[8.5in] items-center gap-3 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[#0f172a]">{org.name ?? "Proposal"}</div>
            <div className="truncate text-xs text-[#64748b]">Proposal {quote.number} · {fmtMoney(quote.totals.totalCents)}</div>
          </div>
          <button className="inline-flex items-center gap-1.5 rounded-lg border border-[#cbd5e1] px-3 py-1.5 text-sm text-[#334155] hover:bg-[#f1f5f9]" onClick={() => window.print()}><Printer size={14} /> <span className="hidden sm:inline">Print or save PDF</span><span className="sm:hidden">PDF</span></button>
        </div>
      </div>

      <div className="mx-auto max-w-[8.5in] px-3 pb-32 pt-4 sm:px-4 print:p-0">
        <div className="no-print">
          {done && p.signature && (
            <Banner tone="ok" icon={<CheckCircle2 size={18} />} title="Signed. Thank you!">
              {p.signature.signerName}{p.signature.signerTitle ? `, ${p.signature.signerTitle}` : ""} signed this proposal on {when(p.signature.signedAt)} for {fmtMoney(p.signature.totalCents)}. {org.name ?? "The team"} will be in touch about next steps.
            </Banner>
          )}
          {done && !p.signature && <Banner tone="ok" icon={<CheckCircle2 size={18} />} title="Accepted">This proposal has been accepted.</Banner>}
          {p.answer?.kind === "CHANGES" && (
            <Banner tone="warn" icon={<MessageSquareText size={18} />} title="You asked for changes">
              {p.answer.note ? <>“{p.answer.note}”. </> : null}{org.name ?? "The team"} is working on an updated proposal. This same link will show it.
            </Banner>
          )}
          {p.answer?.kind === "DECLINED" && <Banner tone="muted" icon={<XCircle size={18} />} title="Declined">You declined this proposal on {when(p.answer.at)}.{p.answer.note ? ` “${p.answer.note}”` : ""}</Banner>}
          {p.expired && <Banner tone="warn" icon={<XCircle size={18} />} title="This proposal has expired">It was valid until {quote.validUntil ? new Date(quote.validUntil).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "an earlier date"}. Ask {org.name ?? "the team"} for an updated one.</Banner>}
        </div>

        <div className="ops-proposal mt-3 rounded-xl bg-white p-5 text-[#111] shadow-sm ring-1 ring-[#e2e8f0] sm:p-10 print:rounded-none print:p-0 print:shadow-none print:ring-0">
          <ProposalDoc data={{ quote, org, logo: p.logo }} chooser={chooser} signature={p.signature ? <SignedBlock p={p} /> : p.canAnswer ? null : undefined} />
        </div>
      </div>

      {p.canAnswer && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-[#e2e8f0] bg-white/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="mx-auto flex max-w-[8.5in] flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
            <div className="hidden flex-1 text-sm text-[#475569] sm:block">Ready? Sign to accept {fmtMoney(quote.totals.totalCents)}{quote.totals.depositCents > 0 ? `, with ${fmtMoney(quote.totals.depositCents)} due at approval` : ""}.</div>
            <button className="order-3 rounded-lg px-3 py-2.5 text-sm text-[#64748b] hover:bg-[#f1f5f9] sm:order-none" onClick={() => setSheet("decline")}>Decline</button>
            <button className="flex-1 whitespace-nowrap rounded-lg border border-[#cbd5e1] px-3 py-2.5 text-sm font-medium text-[#334155] hover:bg-[#f1f5f9] sm:flex-none" onClick={() => setSheet("changes")}>Ask for changes</button>
            <button className="flex-1 whitespace-nowrap rounded-lg bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#115e59] sm:flex-none" onClick={() => setSheet("sign")}><PenLine size={15} className="mr-1.5 hidden sm:inline" />Sign and accept</button>
          </div>
        </div>
      )}

      {sheet === "sign" && <SignSheet token={token} page={p} quote={quote} selections={sel} onClose={() => setSheet(null)} onDone={answered} onStale={() => { setSheet(null); void fetchPage(); }} />}
      {(sheet === "changes" || sheet === "decline") && <AnswerSheet token={token} kind={sheet} page={p} onClose={() => setSheet(null)} onDone={answered} />}
    </Shell>
  );
}

function SignedBlock({ p }: { p: ClientProposalPage }) {
  const s = p.signature!;
  return (
    <section className="mt-10 break-inside-avoid border-t border-[#e2e8f0] pt-4 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">Accepted</div>
      <div className="mt-1">Signed electronically by <b>{s.signerName}</b>{s.signerTitle ? `, ${s.signerTitle}` : ""} on {when(s.signedAt)} for {fmtMoney(s.totalCents)}.</div>
    </section>
  );
}

function SignSheet({ token, page, quote, selections, onClose, onDone, onStale }: { token: string; page: ClientProposalPage; quote: PublicQuote; selections: Selections; onClose: () => void; onDone: (p: ClientProposalPage) => void; onStale: () => void }) {
  const t = quote.totals;
  return (
    <Sheet title="Sign and accept" onClose={onClose}>
      <SignForm defaultName={page.quote.customer.contactName ?? ""} defaultEmail={page.quote.customer.email ?? ""}
        summary={<>
          <div className="flex justify-between"><span className="text-[#64748b]">Total</span><b className="tabular-nums">{fmtMoney(t.totalCents)}</b></div>
          {t.depositCents > 0 && <div className="mt-0.5 flex justify-between"><span className="text-[#64748b]">Due at approval</span><span className="tabular-nums">{fmtMoney(t.depositCents)}</span></div>}
        </>}
        agreeText={`I accept this proposal and its terms for ${fmtMoney(t.totalCents)}, and I agree that my electronic signature is as valid as signing on paper.`}
        button={`Sign and accept ${fmtMoney(t.totalCents)}`}
        onSign={async ({ name, title, email, signature }) => {
          try { onDone(await opsPublic<ClientProposalPage>(`/public/proposals/${encodeURIComponent(token)}/sign`, { name, title, email, signature, totalCents: t.totalCents, agree: true, selections })); }
          catch (err) { if (err instanceof OpsError && err.body.status === "changed") { onStale(); return; } throw err; }
        }} />
    </Sheet>
  );
}

function AnswerSheet({ token, kind, page, onClose, onDone }: { token: string; kind: "changes" | "decline"; page: ClientProposalPage; onClose: () => void; onDone: (p: ClientProposalPage) => void }) {
  const [name, setName] = useState(page.quote.customer.contactName ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = kind === "changes";
  return (
    <Sheet title={changes ? "Ask for changes" : "Decline the proposal"} onClose={onClose}>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { onDone(await opsPublic<ClientProposalPage>(`/public/proposals/${encodeURIComponent(token)}/${kind}`, { name, note })); }
        catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <p className="text-sm text-[#475569]">{changes ? `Tell ${page.org.name ?? "the team"} what you'd like different. They'll send an updated proposal to this same link.` : `Let ${page.org.name ?? "the team"} know you won't be going ahead. A reason helps, but it's up to you.`}</p>
        <div><label className={label} htmlFor="ans-name">Your name</label><input id="ans-name" className={input} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className={label} htmlFor="ans-note">{changes ? "What should change?" : "Reason (optional)"}</label><textarea id="ans-note" rows={5} required={changes} className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder={changes ? "e.g. Could you add a second confidence monitor and drop the subwoofer?" : ""} /></div>
        {error && <p className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c]">{error}</p>}
        <button className={clsx("w-full rounded-lg px-4 py-3 text-[15px] font-semibold text-white disabled:opacity-60", changes ? "bg-[#0f766e] hover:bg-[#115e59]" : "bg-[#475569] hover:bg-[#334155]")} disabled={busy}>{busy ? "Sending…" : changes ? "Send my changes" : "Decline"}</button>
      </form>
    </Sheet>
  );
}
