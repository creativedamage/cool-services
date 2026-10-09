/**
 * AVL emails (through the organization's email settings, like request emails):
 *
 *   proposal sent       → the client's contact, with the link to see and sign it
 *   client answered     → whoever made the proposal (signed, wants changes, declined)
 *
 * Worked out inside the request (this organization's data) and sent once the change is saved. An
 * email problem never stops the proposal itself.
 */
import { afterCommit, ctx, getAvl, getOrg, orgId, sql } from "./db.ts";
import { isEmail, render, send, senderFor, SITE, underDailyLimit, type Message } from "./mail.ts";
import { mailSettings } from "./notify.ts";
import { effectiveTotals, loadQuote, proposalUrl } from "./quotes.ts";

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const first = (n?: string | null) => (n ?? "").trim().split(/\s+/)[0] || "there";

/** Queue emails to go once the change is saved. Returns why they can't go (null: they're on their way). */
async function queue(messages: (Message & { kind: string })[], fromName: string): Promise<string | null> {
  if (!messages.length) return null;
  const m = await mailSettings();
  if (m.provider === "off") return OFF;
  const { sender, why } = await senderFor(m, (m.fromName as string) || fromName);
  const id = orgId();
  afterCommit(async () => {
    const ok = sender?.viaSundays ? await underDailyLimit({ orgId: id }) : true;
    for (const msg of messages) await send(ok ? sender : null, { ...msg, replyTo: msg.replyTo ?? (m.replyTo || null) }, { orgId: id, kind: msg.kind }, ok ? why : "Today’s limit for Sundays’ email relay was reached.");
  });
  return sender ? null : setupHint(why);
}

const OFF = "Email is turned off for your organization (Operations → Settings → Organization → Email).";
/** What to do about a missing sender, in words. */
const setupHint = (why: string | null) =>
  why?.includes("relay")
    ? "No email service is set up yet. Add a Brevo or Resend API key in Operations → Settings → Organization → Email (or set up Sundays’ relay in Sundays admin → Email)."
    : `${why ?? "No email sender."} (Operations → Settings → Organization → Email)`;

/** The business's name on AVL emails: its AVL name, else the organization's. */
async function businessName() {
  const [avl, org] = await Promise.all([getAvl(), getOrg()]);
  return { name: (avl.name as string) || (org.name as string) || "Your AV team", replyTo: (avl.email as string) || null };
}

/** Email the proposal link to the client. Returns where it's going, or why it can't go. */
export async function emailProposal(quoteId: string, to?: string | null): Promise<{ emailedTo: string | null; emailError: string | null }> {
  try {
    const m = await mailSettings();
    if (m.provider === "off") return { emailedTo: null, emailError: OFF };
    const q = await loadQuote(quoteId);
    const address = (to?.trim() || q.customer.email || "").trim();
    if (!isEmail(address)) return { emailedTo: null, emailError: "There’s no email address to send it to." };
    const biz = await businessName();
    const t = effectiveTotals(q);
    const { html, text } = render({
      org: biz.name, heading: `Your proposal: ${q.title}`,
      intro: [
        `Hi ${first(q.customer.contactName)}, here is our proposal for ${q.customer.name}.`,
        "Open it to read the details, then sign it online, or tell us what you’d like changed.",
      ],
      rows: [["Proposal", q.number], ["Total", money(t.totalCents)], ["Valid until", q.validUntil ? new Date(q.validUntil).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null]],
      buttons: [{ label: "View and sign the proposal", url: proposalUrl(q.publicToken) }],
      footer: `Sent by Sundays for ${biz.name}. Questions? Reply to this email.`,
      accent: "#0F766E",
    });
    const err = await queue([{ kind: "avl.proposal", to: { email: address, name: q.customer.contactName }, subject: `Proposal ${q.number}: ${q.title}`, html, text, replyTo: biz.replyTo }], biz.name);
    return err ? { emailedTo: null, emailError: err } : { emailedTo: address, emailError: null };
  } catch (e) {
    console.error("proposal email failed", e, ctx()?.orgId);
    return { emailedTo: null, emailError: "The email couldn’t be prepared. Try again, or copy the link instead." };
  }
}

/** Tell whoever made the proposal that the client answered. */
export async function notifyAnswer(kind: "SIGNED" | "CHANGES" | "DECLINED", quoteId: string, who: string, note?: string | null) {
  try {
    const q = await loadQuote(quoteId);
    const [maker] = await sql`select name, email from ops.users where id = ${q.createdById} and active and email is not null`;
    if (!maker?.email) return;
    const biz = await businessName();
    const link = `${SITE}/avl/quotes/view?id=${encodeURIComponent(q.id)}`;
    const t = effectiveTotals(q);
    const what = {
      SIGNED: { subject: `Signed: ${q.title} (${q.number})`, heading: `${q.customer.name} signed the proposal`, intro: `${who} signed ${q.number} for ${money(t.totalCents)}. Create the job from the proposal when you’re ready.`, tone: "good" as const },
      CHANGES: { subject: `Changes asked for: ${q.title} (${q.number})`, heading: `${q.customer.name} would like changes`, intro: `${who} asked for changes to ${q.number}.`, tone: "primary" as const },
      DECLINED: { subject: `Declined: ${q.title} (${q.number})`, heading: `${q.customer.name} declined the proposal`, intro: `${who} declined ${q.number}.`, tone: "bad" as const },
    }[kind];
    const { html, text } = render({
      org: biz.name, heading: what.heading, intro: [`Hi ${first(maker.name)}, ${what.intro}`],
      rows: [["Proposal", `${q.number} · ${q.title}`], ["Client", q.customer.name], ["Total", money(t.totalCents)]],
      note: note?.trim() ? { label: kind === "CHANGES" ? "What they asked for" : "Their note", text: note.trim() } : null,
      buttons: [{ label: "Open the proposal", url: link, tone: what.tone }],
      footer: `Sent by Sundays for ${biz.name}. You’re getting this because you made this proposal.`,
      accent: "#0F766E",
    });
    await queue([{ kind: `avl.answer.${kind.toLowerCase()}`, to: { email: maker.email, name: maker.name }, subject: what.subject, html, text }], biz.name);
  } catch (e) {
    console.error("proposal answer email failed", e, ctx()?.orgId);
  }
}
