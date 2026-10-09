/**
 * Quote service: the only place quote status is written. Every status change goes through
 * applyEvent, which row-locks the quote, checks the state machine + guards, updates timestamps and
 * writes an audit event in one transaction. Ported from coolchurch-ops lib/server/quotes.ts.
 */
import { leadFollowsQuote } from "./crm.ts";
import { computeTotals } from "./lib/math.ts";
import { normalizeOptions } from "./lib/estimating.ts";
import { isEditable, transition, type Actor, type QuoteEventType, type QuoteGuardContext, type QuoteStatus } from "./lib/state-machine.ts";
import type { PublicQuote, QuoteDTO } from "./lib/types.ts";
import { getAvl, HttpError, nextNumber, sql, type Tx } from "./db.ts";
import { SITE } from "./mail.ts";

/** The page a client opens to see, sign or answer a proposal (on the website). */
export const proposalUrl = (token: string) => `${SITE}/proposal?t=${encodeURIComponent(token)}`;

type Db = typeof sql | Tx;

export const newPublicToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// deno-lint-ignore no-explicit-any
export type FullQuote = Record<string, any> & {
  id: string; number: string; status: QuoteStatus; taxBps: number; discountCents: number; depositBps: number;
  items: { quantity: number; unitCostCents: number; unitPriceCents: number; taxable: boolean }[];
  customer: { taxExempt: boolean; email: string | null; name: string; contactName: string | null };
  signature: { totalCentsAtSigning: number; signerName: string; signerEmail: string; signerTitle: string | null; imageDataUrl: string; signedAt: string } | null;
  payments: { status: string; amountCents: number }[];
};

export async function loadQuote(id: string, db: Db = sql, lock = false): Promise<FullQuote> {
  const [q] = lock ? await db`select * from ops.quotes where id = ${id} for update` : await db`select * from ops.quotes where id = ${id}`;
  if (!q) throw new HttpError(404, "Quote not found");
  const [items, [customer], [signature], payments] = await Promise.all([
    db`select * from ops.quote_items where quote_id = ${id} order by sort_order, id`,
    db`select * from ops.customers where id = ${q.customerId}`,
    db`select * from ops.quote_signatures where quote_id = ${id}`,
    db`select * from ops.payments where quote_id = ${id}`,
  ]);
  return { ...q, items, customer, signature: signature ?? null, payments } as unknown as FullQuote;
}

export const liveTotals = (q: FullQuote) =>
  computeTotals(q.items, { taxBps: q.taxBps, discountCents: q.discountCents, depositBps: q.depositBps, taxExempt: q.customer?.taxExempt });

/** Once sent, prices are frozen to the snapshot taken at send time; while editable, they're live. */
export function effectiveTotals(q: FullQuote) {
  const live = liveTotals(q);
  if (isEditable(q.status) || q.sentTotalCents == null) return live;
  return { ...live, subtotalCents: q.sentSubtotalCents ?? live.subtotalCents, taxCents: q.sentTaxCents ?? live.taxCents, totalCents: q.sentTotalCents, depositCents: q.sentDepositCents ?? live.depositCents };
}

export const paidCents = (q: FullQuote) => q.payments.filter((p) => p.status === "SUCCEEDED").reduce((s, p) => s + p.amountCents, 0);

function guardContext(q: FullQuote, note?: string | null): QuoteGuardContext {
  const t = effectiveTotals(q);
  return {
    itemCount: q.items.length, totalCents: t.totalCents, customerEmail: q.customer.email, hasSignature: !!q.signature,
    signedTotalCents: q.signature?.totalCentsAtSigning ?? null, paidCents: paidCents(q), requiredDepositCents: t.depositCents, note,
  };
}

export async function applyEvent(opts: { quoteId: string; event: QuoteEventType; actor: Actor; actorId?: string | null; actorLabel?: string | null; note?: string | null }) {
  return sql.begin(async (tx) => {
    const q = await loadQuote(opts.quoteId, tx, true);
    const res = transition(q.status, opts.event, opts.actor, guardContext(q, opts.note));
    if (!res.ok) throw new HttpError(409, res.error);
    const now = new Date();
    const data: Record<string, unknown> = { status: res.to, updatedAt: now };
    switch (opts.event) {
      case "SEND": {
        const t = liveTotals(q);
        const org = await getAvl(tx);
        // Each send is a version the client saw: v1, then v2 after a revision…
        const [{ n }] = await tx`select count(*)::int as n from ops.quote_versions where quote_id = ${q.id}`;
        data.version = n + 1;
        Object.assign(data, {
          sentAt: now, sentSubtotalCents: t.subtotalCents, sentTaxCents: t.taxCents, sentTotalCents: t.totalCents, sentDepositCents: t.depositCents,
          validUntil: q.validUntil ?? new Date(now.getTime() + org.quoteValidDays * 86_400_000), declinedAt: null,
        });
        // A re-sent (revised) quote needs a fresh signature.
        if (q.signature) await tx`delete from ops.quote_signatures where quote_id = ${q.id}`;
        break;
      }
      case "ACCEPT": case "MARK_ACCEPTED":
        data.acceptedAt = now;
        // What was chosen becomes the proposal: options and add-ons not picked are dropped (the
        // version sent keeps everything that was offered).
        await tx`delete from ops.quote_items where quote_id = ${q.id} and selected = false`;
        break;
      case "DECLINE": case "MARK_DECLINED": data.declinedAt = now; break;
      case "CONVERT": data.convertedAt = now; break;
      case "REVISE": case "REOPEN":
        Object.assign(data, { sentSubtotalCents: null, sentTaxCents: null, sentTotalCents: null, sentDepositCents: null });
        break;
    }
    await tx`update ops.quotes set ${tx(data)} where id = ${q.id}`;
    await tx`insert into ops.quote_events ${tx({ quoteId: q.id, type: opts.event, fromStatus: q.status, toStatus: res.to, actorId: opts.actorId ?? null, actorLabel: opts.actorLabel ?? null, note: opts.note ?? null })}`;
    await leadFollowsQuote(tx, q.id, opts.event, q.number);
    const after = await loadQuote(q.id, tx);
    if (opts.event === "SEND") {
      const pub = toPublicQuote(after);
      await tx`insert into ops.quote_versions ${tx({ quoteId: q.id, version: after.version, sentById: opts.actorId ?? null, totalCents: pub.totals.totalCents, snapshot: tx.json(pub as never) })}`;
    }
    return after;
  });
}

export async function createQuote(input: { title: string; customerId: string; createdById: string; campusId?: string | null }) {
  const org = await getAvl();
  return sql.begin(async (tx) => {
    const [q] = await tx`insert into ops.quotes ${tx({
      number: await nextNumber(tx, "Q", org.quotePrefix), title: input.title, customerId: input.customerId, createdById: input.createdById,
      campusId: input.campusId ?? null, taxBps: org.defaultTaxBps, depositBps: org.defaultDepositBps, terms: org.quoteTerms,
      publicToken: newPublicToken(),
    })} returning *`;
    await tx`insert into ops.quote_events ${tx({ quoteId: q.id, type: "CREATE", toStatus: "DRAFT", actorId: input.createdById })}`;
    return q;
  });
}

export interface QuoteItemInput {
  productId?: string | null; isCustom: boolean; section?: string | null; sku?: string | null; name: string; description?: string | null;
  quantity: number; unitCostCents: number; unitPriceCents: number; taxable: boolean;
  optionGroup?: string | null; optionChoice?: string | null; selected?: boolean; kitName?: string | null;
}

export async function saveQuote(id: string, actorId: string, input: {
  title: string; customerId: string; campusId?: string | null; introNotes?: string | null; internalNotes?: string | null; terms?: string | null;
  taxBps: number; discountCents: number; depositBps: number; validUntil?: string | null; items: QuoteItemInput[];
}) {
  return sql.begin(async (tx) => {
    const [q] = await tx`select status from ops.quotes where id = ${id} for update`;
    if (!q) throw new HttpError(404, "Quote not found");
    if (!isEditable(q.status)) throw new HttpError(409, `Quote is ${q.status} and can no longer be edited.`);
    await tx`delete from ops.quote_items where quote_id = ${id}`;
    await tx`update ops.quotes set ${tx({
      title: input.title, customerId: input.customerId, campusId: input.campusId ?? null, introNotes: input.introNotes ?? null,
      internalNotes: input.internalNotes ?? null, terms: input.terms ?? null, taxBps: input.taxBps, discountCents: input.discountCents,
      depositBps: input.depositBps, validUntil: input.validUntil ? new Date(input.validUntil) : null, updatedAt: new Date(),
    })} where id = ${id}`;
    if (input.items.length) {
      await tx`insert into ops.quote_items ${tx(normalizeOptions(input.items).map((it, i) => ({
        quoteId: id, productId: it.isCustom ? null : it.productId ?? null, isCustom: it.isCustom, section: it.section ?? null, sku: it.sku ?? null,
        name: it.name, description: it.description ?? null, quantity: it.quantity, unitCostCents: it.unitCostCents, unitPriceCents: it.unitPriceCents,
        taxable: it.taxable, sortOrder: i, optionGroup: it.optionGroup ?? null, optionChoice: it.optionChoice ?? null, selected: it.selected ?? true,
        kitName: it.kitName ?? null,
      })))}`;
    }
    await tx`insert into ops.quote_events ${tx({ quoteId: id, type: "EDIT", actorId })}`;
    return loadQuote(id, tx);
  });
}

export async function quoteDTO(id: string): Promise<QuoteDTO> {
  const q = await loadQuote(id);
  const [events, [job], versions] = await Promise.all([
    sql`select e.*, a.name as actor_name from ops.quote_events e left join ops.users a on a.id = e.actor_id
      where e.quote_id = ${id} order by e.created_at desc limit 50`,
    sql`select id, number from ops.jobs where quote_id = ${id}`,
    sql`select v.version, v.sent_at, v.total_cents, u.name as sent_by from ops.quote_versions v left join ops.users u on u.id = v.sent_by_id where v.quote_id = ${id} order by v.version desc`,
  ]);
  return {
    id: q.id, number: q.number, title: q.title, status: q.status, customerId: q.customerId, campusId: q.campusId,
    introNotes: q.introNotes, internalNotes: q.internalNotes, terms: q.terms, taxBps: q.taxBps, discountCents: q.discountCents,
    depositBps: q.depositBps, validUntil: q.validUntil ? new Date(q.validUntil).toISOString() : null, sentTotalCents: q.sentTotalCents,
    items: q.items.map((i: Record<string, any>) => ({
      key: i.id, productId: i.productId, isCustom: i.isCustom, section: i.section, sku: i.sku, name: i.name, description: i.description,
      quantity: i.quantity, unitCostCents: i.unitCostCents, unitPriceCents: i.unitPriceCents, taxable: i.taxable,
      optionGroup: i.optionGroup ?? null, optionChoice: i.optionChoice ?? null, selected: i.selected !== false, kitName: i.kitName ?? null,
    })),
    events: events.map((e) => ({ id: e.id, type: e.type, fromStatus: e.fromStatus, toStatus: e.toStatus, actorLabel: e.actorLabel ?? e.actorName ?? null, note: e.note, createdAt: new Date(e.createdAt).toISOString() })),
    signature: q.signature ? {
      signerName: q.signature.signerName, signerEmail: q.signature.signerEmail, signerTitle: q.signature.signerTitle ?? null,
      signedAt: new Date(q.signature.signedAt).toISOString(), imageDataUrl: q.signature.imageDataUrl, totalCents: q.signature.totalCentsAtSigning,
    } : null,
    paidCents: paidCents(q),
    clientUrl: proposalUrl(q.publicToken),
    viewedAt: q.viewedAt ? new Date(q.viewedAt).toISOString() : null,
    job: job ? { id: job.id, number: job.number } : null,
    version: q.version ?? 1,
    versions: versions.map((v) => ({ version: v.version, sentAt: new Date(v.sentAt).toISOString(), sentBy: v.sentBy ?? null, totalCents: Number(v.totalCents) })),
  };
}

/** Everything the customer may see — never cost, margin or internal notes. */
export function toPublicQuote(q: FullQuote): PublicQuote {
  const t = effectiveTotals(q);
  const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
  return {
    number: q.number, title: q.title, status: q.status, introNotes: q.introNotes, terms: q.terms,
    validUntil: iso(q.validUntil), sentAt: iso(q.sentAt), createdAt: iso(q.createdAt)!,
    customer: { name: q.customer.name, contactName: q.customer.contactName, email: q.customer.email },
    items: q.items.map((i: Record<string, any>) => ({
      id: i.id, section: i.section, sku: i.sku, name: i.name, description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents, taxable: i.taxable,
      optionGroup: i.optionGroup ?? null, optionChoice: i.optionChoice ?? null, selected: i.selected !== false,
    })),
    pricing: { taxBps: q.taxBps, discountCents: q.discountCents, depositBps: q.depositBps, taxExempt: !!q.customer?.taxExempt },
    version: q.version ?? 1,
    totals: { subtotalCents: t.subtotalCents, discountCents: t.discountCents, taxCents: t.taxCents, totalCents: t.totalCents, depositCents: t.depositCents },
  };
}
