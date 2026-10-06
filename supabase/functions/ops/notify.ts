/**
 * Request emails (Settings → Organization → Email decides which go out):
 *
 *   new work order / supply request        → the handling team
 *   waiting for approval                    → the approving team
 *   approved                                → whoever asked (with the note), and the handling team
 *   declined                                → whoever asked, with the reason
 *   assigned                                → the person it's assigned to
 *   on hold / ordered / done                → whoever asked
 *
 * Everything is worked out inside the request (so it's this organization's data), then sent once
 * the change is saved. Nobody gets an email about something they did themselves.
 */
import { afterCommit, ctx, getOrg, orgId, sql } from "./db.ts";
import { render, send, senderFor, SITE, underDailyLimit, type Message, type Recipient } from "./mail.ts";
import type { RequestRow } from "./lib/types.ts";
import type { RequestAction } from "./lib/workflow.ts";

export type RequestEvent = "SUBMIT" | RequestAction;

export async function mailSettings() {
  const [m] = await sql`select * from ops.mail_settings`;
  return m ?? { provider: "sundays", apiKeyEnc: null, fromEmail: null, fromName: null, replyTo: null, notifyTeam: true, notifyApprovers: true, notifyAssignee: true, notifyRequester: true };
}

async function teamPeople(teamId: string | null): Promise<Recipient[]> {
  if (!teamId) return [];
  return (await sql`select u.name, u.email from ops.team_members tm join ops.users u on u.id = tm.user_id
    where tm.team_id = ${teamId} and u.active and not u.pending and u.source <> 'PLATFORM' and u.email is not null`) as unknown as Recipient[];
}

const WHAT = { WORK_ORDER: "work order", FULFILLMENT: "supply request", APPROVAL: "request" } as const;
const money = (c: number | null | undefined) => (c == null ? null : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const PRIORITY: Record<string, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };

/** Work out and queue the emails for something that just happened to a request. */
export async function notifyRequest(event: RequestEvent, row: RequestRow & { approverTeamId?: string | null; decisionNote?: string | null }, actor: { id: string; email?: string | null }, note?: string | null) {
  try {
    const m = await mailSettings();
    if (m.provider === "off") return;
    const org = await getOrg();
    const orgName = (org.name as string) || "Your church";
    const r = row;
    const what = WHAT[r.category.workflow as keyof typeof WHAT] ?? "request";
    const link = `${SITE}/ops/requests/view?id=${encodeURIComponent(r.id)}`;
    const lines = (r.lines ?? []).map((l) => `${l.quantity}× ${l.description}${l.unit ? ` (${l.unit})` : ""}`).join(", ");
    const facts: [string, string | null | undefined][] = [
      ["Request", `${r.number} · ${r.title}`],
      ["Type", r.category.name],
      ["Campus", r.campus.name],
      ["Where", r.location],
      ["Asked by", r.requester.name],
      ["Priority", r.priority !== "NORMAL" ? PRIORITY[r.priority] : null],
      ["Needed by", r.neededBy ? new Date(r.neededBy).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : null],
      ["Items", lines || null],
      ["Estimate", money(r.estimatedCents)],
    ];
    const details = r.details?.trim() ? { label: "Details", text: r.details.trim() } : null;
    const open = { label: "Open in Sundays", url: link };
    type Out = { to: Recipient[]; subject: string; heading: string; intro: string[]; note?: { label: string; text: string } | null; kind: string; tone?: string };
    const out: Out[] = [];
    const requester: Recipient[] = r.requester.email ? [{ email: r.requester.email, name: r.requester.name }] : [];
    const first = (n?: string | null) => (n ?? "").split(" ")[0] || "there";

    if (event === "SUBMIT") {
      if (r.status === "PENDING_APPROVAL") {
        if (m.notifyApprovers) out.push({ kind: "request.approval", to: await teamPeople(r.approverTeamId ?? null), subject: `Approval needed: ${r.title} (${r.number})`, heading: `${r.requester.name} needs approval`, intro: [`A new ${what} is waiting for your team to approve or decline it.`], note: details });
      } else if (m.notifyTeam) {
        out.push({ kind: "request.new", to: await teamPeople(r.assignedTeam?.id ?? r.assignedTeamId ?? null), subject: `New ${what}: ${r.title} (${r.number})`, heading: `New ${what} for your team`, intro: [`${r.requester.name} sent a ${what}${r.location ? ` for ${r.location}` : ""}.`], note: details });
      }
    } else if (event === "APPROVE") {
      if (m.notifyRequester) out.push({ kind: "request.approved", to: requester, subject: `Approved: ${r.title} (${r.number})`, heading: "Your request was approved", intro: [`Hi ${first(r.requester.name)}, your ${what} was approved${r.assignedTeam ? ` and is with ${r.assignedTeam.name}` : ""}.`], note: note?.trim() ? { label: "Note", text: note.trim() } : null });
      if (m.notifyTeam) out.push({ kind: "request.new", to: await teamPeople(r.assignedTeam?.id ?? r.assignedTeamId ?? null), subject: `New ${what}: ${r.title} (${r.number})`, heading: `New ${what} for your team`, intro: [`${r.requester.name}’s ${what} was approved and is ready for your team.`], note: details });
    } else if (event === "DENY") {
      if (m.notifyRequester) out.push({ kind: "request.denied", to: requester, subject: `Declined: ${r.title} (${r.number})`, heading: "Your request was declined", intro: [`Hi ${first(r.requester.name)}, your ${what} wasn’t approved.`], note: { label: "Why", text: note?.trim() || "No reason was given." } });
    } else if (event === "ASSIGN") {
      if (m.notifyAssignee && r.assignee?.email) out.push({ kind: "request.assigned", to: [{ email: r.assignee.email, name: r.assignee.name }], subject: `Assigned to you: ${r.title} (${r.number})`, heading: `This ${what} is yours`, intro: [`Hi ${first(r.assignee.name)}, you’ve been assigned ${r.requester.name}’s ${what}.`], note: details });
    } else if (event === "HOLD") {
      if (m.notifyRequester) out.push({ kind: "request.hold", to: requester, subject: `On hold: ${r.title} (${r.number})`, heading: "Your request is on hold", intro: [`Hi ${first(r.requester.name)}, your ${what} is on hold for now.`], note: note?.trim() ? { label: "Why", text: note.trim() } : null });
    } else if (event === "ORDER") {
      if (m.notifyRequester) out.push({ kind: "request.ordered", to: requester, subject: `Ordered: ${r.title} (${r.number})`, heading: "It’s been ordered", intro: [`Hi ${first(r.requester.name)}, what you asked for has been ordered.`], note: note?.trim() ? { label: "Note", text: note.trim() } : null });
    } else if (event === "COMPLETE") {
      if (m.notifyRequester) out.push({ kind: "request.done", to: requester, subject: `Done: ${r.title} (${r.number})`, heading: "Your request is done", intro: [`Hi ${first(r.requester.name)}, your ${what} has been completed.`], note: note?.trim() ? { label: "Note", text: note.trim() } : null });
    }

    const actorEmail = actor.email?.toLowerCase() ?? null;
    const messages: (Message & { kind: string })[] = [];
    for (const o of out) {
      const seen = new Set<string>();
      for (const to of o.to) {
        const e = to.email.toLowerCase();
        if (e === actorEmail || seen.has(e)) continue;
        seen.add(e);
        const { html, text } = render({ org: orgName, heading: o.heading, intro: o.intro, rows: facts, note: o.note, buttons: [open], footer: `Sent by Sundays for ${orgName}. You’re getting this because of your part in this request.` });
        messages.push({ kind: o.kind, to, subject: o.subject, html, text, replyTo: m.replyTo || null });
      }
    }
    if (!messages.length) return;
    const { sender, why } = await senderFor(m, (m.fromName as string) || orgName);
    const id = orgId();
    afterCommit(async () => {
      const ok = sender?.viaSundays ? await underDailyLimit({ orgId: id }) : true;
      for (const msg of messages.slice(0, 50)) await send(ok ? sender : null, msg, { orgId: id, kind: msg.kind }, ok ? why : "Today’s limit for Sundays’ email relay was reached.");
    });
  } catch (e) {
    // An email problem never stops the request itself.
    console.error("request email failed", e, ctx()?.orgId);
  }
}
