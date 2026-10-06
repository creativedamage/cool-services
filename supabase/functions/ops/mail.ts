/**
 * Email from Sundays (Operations request emails): through Brevo or Resend (both are web APIs; Supabase doesn't let functions
 * talk to mail servers directly).
 *
 * Who sends: Sundays' relay (one account a Sundays super admin sets up in the admin console, used
 * by every organization that hasn't set up its own), or the organization's own Brevo/Resend
 * account. Replies go to the organization's reply-to address.
 *
 * OPS_MAIL_CAPTURE (tests only): POST each email to that address instead of sending it.
 */
import { env, raw } from "./db.ts";

export type Provider = "brevo" | "resend";
export type MailChoice = "sundays" | Provider | "off";
export interface Sender { provider: Provider; apiKey: string; fromEmail: string; fromName: string; viaSundays: boolean }
export interface Recipient { email: string; name?: string | null }
export interface Message { to: Recipient; subject: string; html: string; text: string; replyTo?: string | null }

/* ── Keys are stored encrypted (AES-GCM; the key is "mail_key" in public.app_secrets) ── */

let keyP: Promise<CryptoKey> | null = null;
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function mailKey(): Promise<CryptoKey> {
  return (keyP ??= (async () => {
    let [row] = await raw`select value from public.app_secrets where name = 'mail_key'`;
    if (!row) {
      await raw`insert into public.app_secrets (name, value) values ('mail_key', ${b64(crypto.getRandomValues(new Uint8Array(32)))}) on conflict (name) do nothing`;
      [row] = await raw`select value from public.app_secrets where name = 'mail_key'`;
    }
    return crypto.subtle.importKey("raw", unb64(row.value), "AES-GCM", false, ["encrypt", "decrypt"]);
  })().catch((e) => { keyP = null; throw e; }));
}
export async function seal(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await mailKey(), new TextEncoder().encode(plain)));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function unseal(sealed: string): Promise<string> {
  const [iv, ct] = sealed.split(".").map(unb64);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await mailKey(), ct));
}
/** A new key from a settings form: "" clears it, undefined keeps the saved one. */
export async function keyUpdate(input: string | null | undefined, current: string | null): Promise<string | null> {
  if (input === undefined) return current;
  return input && input.trim() ? seal(input.trim()) : null;
}

/* ── Sending ── */

export const isEmail = (v: unknown): v is string => typeof v === "string" && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v);

async function deliver(s: Sender, m: Message): Promise<void> {
  const capture = env("OPS_MAIL_CAPTURE");
  if (capture) {
    const r = await fetch(capture, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: s.provider, from: { email: s.fromEmail, name: s.fromName }, ...m }) });
    if (!r.ok) throw new Error(`capture ${r.status}`);
    return;
  }
  if (s.provider === "brevo") {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": s.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { email: s.fromEmail, name: s.fromName },
        to: [{ email: m.to.email, ...(m.to.name ? { name: m.to.name } : {}) }],
        subject: m.subject, htmlContent: m.html, textContent: m.text,
        ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}),
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(`Brevo said: ${(j as { message?: string }).message ?? `HTTP ${r.status}`}`);
    }
    return;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${s.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${s.fromName.replace(/[<>"]/g, "")} <${s.fromEmail}>`,
      to: [m.to.email], subject: m.subject, html: m.html, text: m.text,
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
    }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`Resend said: ${(j as { message?: string }).message ?? `HTTP ${r.status}`}`);
  }
}

/** Sundays' relay, if a super admin has set it up. */
export async function relay(): Promise<Sender | null> {
  const [p] = await raw`select * from ops.platform_mail where id = 'platform'`;
  if (!p?.apiKeyEnc || !isEmail(p.fromEmail)) return null;
  return { provider: p.provider, apiKey: await unseal(p.apiKeyEnc), fromEmail: p.fromEmail, fromName: p.fromName || "Sundays", viaSundays: true };
}
export async function relayAvailable(): Promise<{ available: boolean; fromEmail: string | null }> {
  const [p] = await raw`select api_key_enc, from_email from ops.platform_mail where id = 'platform'`;
  return { available: Boolean(p?.apiKeyEnc && isEmail(p.fromEmail)), fromEmail: p?.fromEmail ?? null };
}

/** Who sends for an organization or church (its settings row), as `name` (e.g. the church). */
export async function senderFor(cfg: { provider?: MailChoice; apiKeyEnc?: string | null; fromEmail?: string | null; fromName?: string | null } | Record<string, any> | null, name: string): Promise<{ sender: Sender | null; why: string | null }> {
  const choice = ((cfg?.provider as MailChoice | undefined) ?? "sundays");
  if (choice === "off") return { sender: null, why: "Email is turned off." };
  if (choice === "sundays") {
    const r = await relay();
    if (!r) return { sender: null, why: "Sundays’ email relay isn’t set up yet." };
    return { sender: { ...r, fromName: cfg?.fromName?.trim() || name || r.fromName }, why: null };
  }
  if (!cfg?.apiKeyEnc || !isEmail(cfg.fromEmail)) return { sender: null, why: "Add your email service’s API key and sending address." };
  return { sender: { provider: choice, apiKey: await unseal(cfg.apiKeyEnc), fromEmail: cfg.fromEmail!, fromName: cfg.fromName?.trim() || name || "Sundays", viaSundays: false }, why: null };
}

export interface LogMeta { orgId?: string | null; kind: string }
async function log(meta: LogMeta, recipient: string, subject: string, status: "SENT" | "FAILED" | "SKIPPED", error: string | null) {
  try {
    await raw`insert into ops.mail_log ${raw({ orgId: meta.orgId ?? null, kind: meta.kind, recipient, subject: subject.slice(0, 300), status, error: error?.slice(0, 500) ?? null })}`;
  } catch (e) { console.error("mail log failed", e); }
}

/** Send one email and write it down. Returns the error (null when it went). */
export async function send(sender: Sender | null, m: Message, meta: LogMeta, why?: string | null): Promise<string | null> {
  if (!sender) { await log(meta, m.to.email, m.subject, "SKIPPED", why ?? "No email sender."); return why ?? "No email sender."; }
  try {
    await deliver(sender, m);
    await log(meta, m.to.email, m.subject, "SENT", null);
    return null;
  } catch (e) {
    const msg = (e as Error).message;
    await log(meta, m.to.email, m.subject, "FAILED", msg);
    return msg;
  }
}

/** At most this many emails per organization a day through Sundays' relay (spam guard). */
export async function underDailyLimit(meta: { orgId: string }, limit = 300): Promise<boolean> {
  const [{ n }] = await raw`select count(*)::int as n from ops.mail_log where org_id = ${meta.orgId} and status = 'SENT' and created_at > now() - interval '1 day'`;
  return n < limit;
}

/* ── The email itself ── */

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface Layout {
  org: string;
  heading: string;
  /** Paragraphs (plain text). */
  intro?: string[];
  rows?: [string, string | null | undefined][];
  note?: { label: string; text: string } | null;
  buttons?: { label: string; url: string; tone?: "primary" | "good" | "bad" | "plain" }[];
  footer?: string;
  accent?: string;
}

/** A plain, readable email that works in every mail app (tables and inline styles). */
export function render(l: Layout): { html: string; text: string } {
  const accent = l.accent ?? "#6D28D9";
  const rows = (l.rows ?? []).filter(([, v]) => v);
  const tone = { primary: accent, good: "#16A34A", bad: "#DC2626", plain: "#475569" } as const;
  const html = `<!doctype html><html><body style="margin:0;background:#F4F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;border:1px solid #E5E7EB">
<tr><td style="padding:22px 26px 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${accent};font-weight:600">${esc(l.org)}</td></tr>
<tr><td style="padding:0 26px 8px;font-size:21px;font-weight:650;line-height:1.3">${esc(l.heading)}</td></tr>
${(l.intro ?? []).map((p) => `<tr><td style="padding:4px 26px;font-size:15px;line-height:1.55;color:#334155">${esc(p)}</td></tr>`).join("")}
${rows.length ? `<tr><td style="padding:12px 26px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E5E7EB">${rows.map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #F1F5F9;font-size:13px;color:#64748B;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #F1F5F9;font-size:14px;color:#0F172A">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table></td></tr>` : ""}
${l.note ? `<tr><td style="padding:12px 26px 4px"><div style="background:#F8FAFC;border-left:3px solid ${accent};border-radius:6px;padding:10px 14px"><div style="font-size:12px;color:#64748B;margin-bottom:4px">${esc(l.note.label)}</div><div style="font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(l.note.text)}</div></div></td></tr>` : ""}
${l.buttons?.length ? `<tr><td style="padding:18px 26px 6px">${l.buttons.map((b) => `<a href="${esc(b.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:11px 18px;border-radius:9px;background:${tone[b.tone ?? "primary"]};color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none">${esc(b.label)}</a>`).join("")}</td></tr>` : ""}
<tr><td style="padding:14px 26px 22px;font-size:12px;line-height:1.5;color:#94A3B8">${esc(l.footer ?? `Sent by Sundays for ${l.org}.`)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    l.org.toUpperCase(), "", l.heading, "",
    ...(l.intro ?? []).flatMap((p) => [p, ""]),
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(l.note ? ["", `${l.note.label}:`, l.note.text] : []),
    ...(l.buttons?.length ? ["", ...l.buttons.map((b) => `${b.label}: ${b.url}`)] : []),
    "", l.footer ?? `Sent by Sundays for ${l.org}.`,
  ].join("\n");
  return { html, text };
}

/** The website (links in emails). */
export const SITE = (env("SUNDAYS_SITE_URL") ?? "https://sundays-ops.vercel.app").replace(/\/+$/, "");
