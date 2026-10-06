"use client";
/**
 * Who sends Sundays' emails, as a form: Sundays' relay (nothing to set up), your own Brevo or
 * Resend account, or off. Used by Settings → Organization → Email (Operations) and the admin
 * console (Sundays' relay itself).
 */
import clsx from "clsx";
import { ExternalLink } from "lucide-react";

export type MailChoice = "sundays" | "brevo" | "resend" | "off";
export interface SenderForm {
  provider: MailChoice;
  /** What's typed in the key box; left empty, the saved key stays. */
  apiKey?: string;
  fromEmail: string | null;
  fromName: string | null;
  replyTo: string | null;
}
export interface MailLogRow { kind: string; recipient: string; subject: string; status: "SENT" | "FAILED" | "SKIPPED"; error: string | null; createdAt: string; who?: string | null }

const LABEL: Record<MailChoice, string> = { sundays: "Sent by Sundays", brevo: "My Brevo account", resend: "My Resend account", off: "Off" };
const HELP: Record<"brevo" | "resend", { blurb: string; steps: string[]; url: string; keyHint: string }> = {
  brevo: {
    blurb: "Free for up to 300 emails a day. No domain needed: you verify one email address and emails come from it.",
    steps: ["Make a free account at brevo.com.", "Senders, Domains & Dedicated IPs → Senders → Add a sender: your address (click the link Brevo emails you).", "SMTP & API → API keys → Generate a new API key, and paste it here."],
    url: "https://app.brevo.com/settings/keys/api", keyHint: "xkeysib-…",
  },
  resend: {
    blurb: "Free for up to 3,000 emails a month. Needs a domain you own (you add a few DNS records once).",
    steps: ["Make a free account at resend.com.", "Domains → Add domain, and add the DNS records it shows.", "API Keys → Create API key (Sending access), and paste it here. Send from an address on that domain."],
    url: "https://resend.com/api-keys", keyHint: "re_…",
  },
};

export function SenderFields({ value, onChange, hasKey, relayAvailable, choices = ["sundays", "brevo", "resend", "off"], name, replyHint }: {
  value: SenderForm; onChange: (v: SenderForm) => void; hasKey: boolean; relayAvailable: boolean;
  choices?: MailChoice[]; name: string; replyHint?: string;
}) {
  const set = (p: Partial<SenderForm>) => onChange({ ...value, ...p });
  const own = value.provider === "brevo" || value.provider === "resend";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border border-line p-0.5">
        {choices.map((c) => (
          <button key={c} type="button" onClick={() => set({ provider: c })}
            className={clsx("flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition", value.provider === c ? "bg-accent text-white" : "text-ink-soft hover:bg-hover")}>
            {LABEL[c]}
          </button>
        ))}
      </div>

      {value.provider === "sundays" && (
        <p className={clsx("rounded-lg px-3 py-2 text-xs", relayAvailable ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
          {relayAvailable
            ? `Nothing to set up. Emails come from Sundays’ address with “${value.fromName || name}” as the name, and replies go to your reply-to address.`
            : "Sundays’ email isn’t switched on yet, so nothing goes out until it is (or until you use your own Brevo or Resend account)."}
        </p>
      )}
      {value.provider === "off" && <p className="rounded-lg bg-hover px-3 py-2 text-xs text-ink-muted">No emails are sent.</p>}

      {own && (
        <div className="rounded-lg border border-line p-3 text-xs text-ink-muted">
          <p>{HELP[value.provider as "brevo"].blurb}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4">{HELP[value.provider as "brevo"].steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <a href={HELP[value.provider as "brevo"].url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-accent hover:underline">Open {value.provider === "brevo" ? "Brevo" : "Resend"} <ExternalLink size={11} /></a>
        </div>
      )}

      {value.provider !== "off" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {own && (
            <label className="block sm:col-span-2"><span className="label mb-1.5 block">API key</span>
              <input className="input font-mono" type="password" autoComplete="off" placeholder={hasKey ? "Saved (type a new one to replace it)" : HELP[value.provider as "brevo"].keyHint}
                value={value.apiKey ?? ""} onChange={(e) => set({ apiKey: e.target.value })} />
            </label>
          )}
          {own && (
            <label className="block"><span className="label mb-1.5 block">Send from (address)</span>
              <input className="input" type="email" placeholder={value.provider === "brevo" ? "The address you verified in Brevo" : "notifications@yourdomain.org"} value={value.fromEmail ?? ""} onChange={(e) => set({ fromEmail: e.target.value })} />
            </label>
          )}
          <label className="block"><span className="label mb-1.5 block">Name it comes from</span>
            <input className="input" placeholder={name} value={value.fromName ?? ""} onChange={(e) => set({ fromName: e.target.value })} />
          </label>
          {choices.includes("sundays") && <label className="block"><span className="label mb-1.5 block">Replies go to</span>
            <input className="input" type="email" placeholder="office@yourchurch.org" value={value.replyTo ?? ""} onChange={(e) => set({ replyTo: e.target.value })} />
            {replyHint && <span className="mt-1 block text-[11px] text-ink-faint">{replyHint}</span>}
          </label>}
        </div>
      )}
    </div>
  );
}

/** What was sent lately (or why not). */
export function MailLog({ rows, showWho }: { rows: MailLogRow[]; showWho?: boolean }) {
  if (!rows.length) return <p className="px-4 py-3 text-xs text-ink-faint">Nothing sent yet.</p>;
  return (
    <div className="divide-y divide-line">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-2 text-xs">
          <span className={clsx("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", r.status === "SENT" ? "bg-ok" : r.status === "FAILED" ? "bg-bad" : "bg-warn")} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-ink-soft">{r.subject}</div>
            <div className="truncate text-[11px] text-ink-faint">
              {showWho && r.who ? `${r.who} · ` : ""}{r.recipient}{r.status !== "SENT" ? ` · ${r.status === "FAILED" ? "Failed" : "Not sent"}: ${r.error ?? ""}` : ""}
            </div>
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        </div>
      ))}
    </div>
  );
}

/** The form's fields for a save request (an untouched key isn't sent, so the saved one stays). */
export const senderJson = (v: SenderForm) => ({
  provider: v.provider, ...(v.apiKey?.trim() ? { apiKey: v.apiKey.trim() } : {}),
  fromEmail: v.fromEmail || null, fromName: v.fromName || null, replyTo: v.replyTo || null,
});
