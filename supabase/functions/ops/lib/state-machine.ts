// Generated from shared/ops/state-machine.ts by supabase/build-ops.mjs — edit that file instead.
/**
 * Quote lifecycle state machine.
 *
 *   DRAFT ──SEND──▶ SENT ──ACCEPT──▶ ACCEPTED ──CONVERT──▶ CONVERTED
 *     ▲               │  └─REQUEST_CHANGES─▶ CHANGES_REQUESTED ─SEND─▶ SENT
 *     │               └─DECLINE─▶ DECLINED                   │
 *     └──────────REVISE / REOPEN──────────────────────────────┘
 *
 * Pure module: no DB access, so it is trivially unit-testable and shared by
 * the ops Edge Function and Sundays' quote screens.
 *
 * Clients answer from the proposal link (sign = ACCEPT, by the system once the signature is in;
 * REQUEST_CHANGES and DECLINE). Staff can also record an answer given another way
 * (MARK_ACCEPTED / MARK_CHANGES / MARK_DECLINED, each with a note); recording an acceptance needs
 * the Quote approve permission (AVL Manager).
 */

export const QUOTE_STATUSES = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "CHANGES_REQUESTED",
  "DECLINED",
  "CONVERTED",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export type QuoteEventType =
  | "SEND" // staff emails the proposal
  | "ACCEPT" // system, after signature + payment
  | "REQUEST_CHANGES" // customer
  | "DECLINE" // customer
  | "REVISE" // staff pulls CHANGES_REQUESTED back into DRAFT for editing
  | "REOPEN" // staff revives a DECLINED quote
  | "CONVERT" // staff marks sale complete / fulfilled
  | "MARK_ACCEPTED" // staff records that the customer accepted (signed on paper, email…)
  | "MARK_CHANGES" // staff records that the customer asked for changes
  | "MARK_DECLINED"; // staff records that the customer said no

export type Actor = "staff" | "customer" | "system";

interface TransitionDef {
  from: readonly QuoteStatus[];
  to: QuoteStatus;
  allowedActors: readonly Actor[];
}

export const TRANSITIONS: Record<QuoteEventType, TransitionDef> = {
  SEND: { from: ["DRAFT", "CHANGES_REQUESTED"], to: "SENT", allowedActors: ["staff"] },
  ACCEPT: { from: ["SENT"], to: "ACCEPTED", allowedActors: ["system"] },
  REQUEST_CHANGES: { from: ["SENT"], to: "CHANGES_REQUESTED", allowedActors: ["customer"] },
  DECLINE: { from: ["SENT"], to: "DECLINED", allowedActors: ["customer"] },
  REVISE: { from: ["CHANGES_REQUESTED"], to: "DRAFT", allowedActors: ["staff"] },
  REOPEN: { from: ["DECLINED"], to: "DRAFT", allowedActors: ["staff"] },
  CONVERT: { from: ["ACCEPTED"], to: "CONVERTED", allowedActors: ["staff"] },
  MARK_ACCEPTED: { from: ["SENT"], to: "ACCEPTED", allowedActors: ["staff"] },
  MARK_CHANGES: { from: ["SENT"], to: "CHANGES_REQUESTED", allowedActors: ["staff"] },
  MARK_DECLINED: { from: ["SENT"], to: "DECLINED", allowedActors: ["staff"] },
};

/** Facts about the quote that guards need. Loaded by the caller. */
export interface QuoteGuardContext {
  itemCount: number;
  totalCents: number;
  customerEmail: string | null | undefined;
  hasSignature: boolean;
  signedTotalCents: number | null; // total at time of signing
  paidCents: number; // sum of SUCCEEDED payments
  requiredDepositCents: number;
  /** The deposit has to be paid online before the proposal is accepted (only with online payments on). */
  paymentRequired?: boolean;
  note?: string | null; // change-request / decline reason
}

export type TransitionResult =
  | { ok: true; to: QuoteStatus }
  | { ok: false; error: string };

const GUARDS: Partial<Record<QuoteEventType, (c: QuoteGuardContext) => string | null>> = {
  // "Send" locks the pricing; the client gets the proposal link (emailed, or shared by staff).
  SEND: (c) => {
    if (c.itemCount === 0) return "Add at least one line item before sending.";
    if (c.totalCents <= 0) return "Quote total must be greater than $0.";
    return null;
  },
  ACCEPT: (c) => {
    if (!c.hasSignature) return "Customer signature is required.";
    if (c.signedTotalCents !== c.totalCents)
      return "Quote changed after it was signed. Please re-sign.";
    if (c.paymentRequired && c.paidCents < c.requiredDepositCents) return "Required payment has not been received.";
    return null;
  },
  REQUEST_CHANGES: (c) => (c.note?.trim() ? null : "Please describe the changes you need."),
  MARK_ACCEPTED: (c) => (c.note?.trim() ? null : "Add how the customer accepted (e.g. signed proposal, email)."),
  MARK_CHANGES: (c) => (c.note?.trim() ? null : "Describe the changes the customer asked for."),
};

export function transition(
  current: QuoteStatus,
  event: QuoteEventType,
  actor: Actor,
  ctx: QuoteGuardContext,
): TransitionResult {
  const def = TRANSITIONS[event];
  if (!def) return { ok: false, error: `Unknown event ${event}` };
  if (!def.allowedActors.includes(actor))
    return { ok: false, error: `${actor} cannot perform ${event}.` };
  if (!def.from.includes(current))
    return { ok: false, error: `Cannot ${event} a quote that is ${current}.` };
  const guardError = GUARDS[event]?.(ctx) ?? null;
  if (guardError) return { ok: false, error: guardError };
  return { ok: true, to: def.to };
}

/** Events a given actor could attempt from the current status (ignores guards). */
export function availableEvents(current: QuoteStatus, actor: Actor): QuoteEventType[] {
  return (Object.keys(TRANSITIONS) as QuoteEventType[]).filter((e) => {
    const d = TRANSITIONS[e];
    return d.from.includes(current) && d.allowedActors.includes(actor);
  });
}

/** Line items / pricing may only be edited in these states. */
export const isEditable = (s: QuoteStatus) => s === "DRAFT" || s === "CHANGES_REQUESTED";

/** Hard delete is only allowed before money or a signature is involved. */
export const isDeletable = (s: QuoteStatus) =>
  s === "DRAFT" || s === "DECLINED" || s === "CHANGES_REQUESTED";

/** Customer can act on the proposal link only while SENT. */
export const isCustomerActionable = (s: QuoteStatus) => s === "SENT";

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  CHANGES_REQUESTED: "Changes Requested",
  DECLINED: "Declined",
  CONVERTED: "Converted",
};
