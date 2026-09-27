"use client";
/**
 * A person at a glance (Matrix → click someone): contact details, what they're scheduled for,
 * blockouts, and an email you can send through Planning Center.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarX2, Copy, Crosshair, ExternalLink, Mail, MapPin, MessageSquare, Phone, Send, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Api, qk } from "@/lib/api";
import { routes } from "@/lib/routes";
import { Avatar, Drawer, Spinner } from "@/components/ui";
import { smsNumber } from "@/components/services/MessageTeamModal";

const DOT = { C: "bg-ok", U: "bg-warn", D: "bg-bad" } as const;
const STATUS = { C: "Confirmed", U: "Pending", D: "Declined" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function PersonPanel({ personId, name, onClose, onTarget }: { personId: string; name: string; onClose: () => void; onTarget?: () => void }) {
  const q = useQuery({ queryKey: qk.profile(personId), queryFn: () => Api.profile(personId), staleTime: 60_000 });
  const p = q.data;
  const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success("Copied"));
  return (
    <Drawer open onClose={onClose}>
      <header className="flex items-start gap-3 border-b border-line p-5">
        <Avatar name={p?.person.name ?? name} src={p?.person.avatarUrl ?? null} size={52} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold">{p?.person.name ?? name}</div>
          <div className="text-xs text-ink-muted">{p?.membership ?? " "}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p && <a href={p.url} target="_blank" rel="noreferrer" className="btn-outline py-1 text-xs"><ExternalLink size={12} /> Planning Center</a>}
            {onTarget && <button className="btn-outline py-1 text-xs" onClick={() => { onTarget(); onClose(); }}><Crosshair size={12} /> Target in Matrix</button>}
          </div>
        </div>
        <button className="btn-ghost -mr-2 p-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {q.isLoading ? <Spinner /> : q.error ? <p className="text-sm text-bad">Couldn’t load this person: {(q.error as Error).message}</p> : p && (
          <>
            <section>
              <h3 className="label mb-1.5">Contact</h3>
              <ul className="space-y-1.5 text-sm">
                {p.emails.map((e) => (
                  <li key={e.address} className="flex items-center gap-2">
                    <Mail size={14} className="shrink-0 text-ink-muted" />
                    <a className="min-w-0 truncate text-accent hover:underline" href={`mailto:${e.address}`}>{e.address}</a>
                    {e.location && <span className="text-[11px] text-ink-faint">{e.location}</span>}
                    <button className="btn-ghost ml-auto p-1" title="Copy" onClick={() => copy(e.address)}><Copy size={12} /></button>
                  </li>
                ))}
                {p.phones.map((n) => (
                  <li key={n.number} className="flex items-center gap-2">
                    <Phone size={14} className="shrink-0 text-ink-muted" />
                    <a className="text-ink hover:underline" href={`tel:${smsNumber(n.number)}`}>{n.number}</a>
                    {n.location && <span className="text-[11px] text-ink-faint">{n.location}</span>}
                    <a className="btn-ghost ml-auto p-1" title="Text in Messages" href={`sms:${smsNumber(n.number)}`}><MessageSquare size={12} /></a>
                    <button className="btn-ghost p-1" title="Copy" onClick={() => copy(n.number)}><Copy size={12} /></button>
                  </li>
                ))}
                {p.address && <li className="flex items-center gap-2 text-ink-soft"><MapPin size={14} className="shrink-0 text-ink-muted" />{p.address}</li>}
                {!p.emails.length && !p.phones.length && <li className="text-ink-muted">No contact details in Planning Center.</li>}
              </ul>
            </section>

            <section>
              <h3 className="label mb-1.5">Scheduled</h3>
              {!p.schedule.length ? <p className="text-sm text-ink-muted">Nothing upcoming.</p> : (
                <ul className="divide-y divide-line/60 rounded-lg border border-line text-sm">
                  {p.schedule.slice(0, 12).map((s, i) => {
                    const body = (
                      <>
                        <span className={clsx("h-2 w-2 shrink-0 rounded-full", DOT[s.status])} title={STATUS[s.status]} />
                        <span className="w-24 shrink-0 text-xs text-ink-muted">{day(s.date)}</span>
                        <span className="min-w-0 flex-1 truncate">{s.position} <span className="text-ink-muted">· {s.teamName}</span></span>
                        <span className="truncate text-[11px] text-ink-faint">{s.serviceTypeName}</span>
                      </>
                    );
                    return (
                      <li key={i}>
                        {s.planId && s.serviceTypeId
                          ? <Link href={routes.plan(s.serviceTypeId, s.planId)} className="flex items-center gap-2 px-3 py-1.5 hover:bg-hover/60">{body}</Link>
                          : <div className="flex items-center gap-2 px-3 py-1.5">{body}</div>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {p.blockouts.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-warn">
                  {p.blockouts.map((b) => <li key={b.id} className="flex items-center gap-1.5"><CalendarX2 size={13} /> Blocked out {day(b.startsAt)} – {day(b.endsAt)}{b.reason ? ` · ${b.reason}` : ""}</li>)}
                </ul>
              )}
            </section>

            <EmailBox personId={personId} to={p.emails.find((e) => e.primary)?.address ?? p.emails[0]?.address ?? null} cards={p.cards} firstName={p.person.firstName} />
          </>
        )}
      </div>
    </Drawer>
  );
}

function EmailBox({ personId, to, cards, firstName }: { personId: string; to: string | null; cards: { id: string; workflowName: string }[]; firstName: string }) {
  const greeting = firstName ? `Hi ${firstName},\n\n` : "";
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(greeting);
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const send = useMutation({
    mutationFn: () => Api.emailPerson(personId, { subject, body, cardId: cardId || undefined }),
    onSuccess: () => { toast.success("Email sent through Planning Center"); setSubject(""); setBody(greeting); },
    onError: (e) => toast.error("Couldn’t send", { description: (e as Error).message }),
  });
  const mailto = to ? `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null;
  const via = cards.find((c) => c.id === cardId)?.workflowName ?? cards[0]?.workflowName;
  return (
    <section>
      <h3 className="label mb-1.5">Send an email</h3>
      {!to ? <p className="text-sm text-ink-muted">No email address in Planning Center.</p> : (
        <div className="space-y-2">
          <input className="input text-sm" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className="input min-h-[120px] text-sm" value={body} onChange={(e) => setBody(e.target.value)} />
          {cards.length > 1 && (
            <select className="input py-1 text-xs" value={cardId} onChange={(e) => setCardId(e.target.value)}>
              {cards.map((c) => <option key={c.id} value={c.id}>Log it on: {c.workflowName}</option>)}
            </select>
          )}
          <div className="flex items-center gap-2">
            <button className="btn-primary text-xs" disabled={!cards.length || !subject.trim() || !body.trim() || send.isPending} onClick={() => send.mutate()}
              title={cards.length ? "Planning Center sends it from you" : "Planning Center only sends email to people in a workflow"}>
              {send.isPending ? <Spinner size={12} /> : <Send size={13} />} Send with Planning Center
            </button>
            {mailto && <a className="btn-ghost text-xs" href={mailto}><Mail size={13} /> Open in Mail</a>}
          </div>
          <p className="text-[11px] text-ink-faint">
            {cards.length
              ? <>Planning Center sends it from you to {to} and logs it on their <b>{via}</b> workflow card.</>
              : <>Planning Center’s API only sends email to people in a workflow, so for {firstName || "them"} use <b>Open in Mail</b> (it’s addressed to {to}).</>}
          </p>
        </div>
      )}
    </section>
  );
}
