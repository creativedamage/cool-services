"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarPlus, ExternalLink, Lock, Mail, Phone, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Board, Note } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { relDays, timeAgo } from "@/lib/format";
import { useUi } from "@/lib/store";
import { Avatar, Badge, Drawer, Skeleton, Spinner } from "@/components/ui";

export function CardDrawer({ board }: { workflowId: string; board: Board }) {
  const { drawerCardId, drawerTab, closeDrawer, openDrawer, openSchedule } = useUi();
  const card = board.cards.find((c) => c.id === drawerCardId);
  if (!card) return null;
  const p = card.person;
  const step = board.steps.find((s) => s.id === card.stepId);

  return (
    <Drawer open onClose={closeDrawer}>
      <div className="relative border-b border-line p-5">
        <button onClick={closeDrawer} className="btn-ghost absolute right-3 top-3 p-1.5" aria-label="Close"><X size={16} /></button>
        <div className="flex items-center gap-4">
          <Avatar name={p.name} src={p.avatarUrl} size={64} />
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{p.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone="accent">{step?.name ?? "—"}</Badge>
              <Badge tone={card.overdue ? "bad" : "muted"}>{relDays(card.movedToStepAt)} in step</Badge>
              {card.assigneeName && <Badge>{card.assigneeName}</Badge>}
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-1.5 text-sm">
          {p.email && <a href={`mailto:${p.email}`} className="flex items-center gap-2 text-ink-soft hover:text-accent"><Mail size={14} className="text-ink-faint" />{p.email}</a>}
          {p.phone && <a href={`tel:${p.phone}`} className="flex items-center gap-2 text-ink-soft hover:text-accent"><Phone size={14} className="text-ink-faint" />{p.phone}</a>}
        </div>
        <div className="mt-4 flex gap-2">
          <button className="btn-primary flex-1" onClick={() => openSchedule({ personId: p.id, name: p.name, avatarUrl: p.avatarUrl })}>
            <CalendarPlus size={15} /> Schedule in Services
          </button>
          <a className="btn-outline" target="_blank" rel="noreferrer" href={`https://people.planningcenteronline.com/people/AC${p.id}`}>
            <ExternalLink size={14} /> PCO
          </a>
        </div>
      </div>

      <div className="flex gap-1 border-b border-line px-5">
        {(["notes", "email"] as const).map((t) => (
          <button key={t} onClick={() => openDrawer(card.id, t)}
            className={clsx("-mb-px border-b-2 px-3 py-2.5 text-sm capitalize transition",
              drawerTab === t ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink-soft")}>
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {drawerTab === "notes"
          ? <NotesTab personId={p.id} cardId={card.id} />
          : <EmailTab personId={p.id} cardId={card.id} firstName={p.firstName} email={p.email} onSent={() => openDrawer(card.id, "notes")} />}
      </div>
    </Drawer>
  );
}

const SOURCE: Record<Note["source"], { label: string; tone: "accent" | "violet" | "warn" }> = {
  card: { label: "Workflow card", tone: "accent" },
  profile: { label: "Profile note", tone: "violet" },
  internal: { label: "Staff-only", tone: "warn" },
};

function NotesTab({ personId, cardId }: { personId: string; cardId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const notes = useQuery({ queryKey: qk.notes(cardId), queryFn: () => Api.notes(personId, cardId) });

  const add = useMutation({
    mutationFn: () => Api.addNote(personId, cardId, body.trim(), internal),
    onSuccess: (n) => {
      qc.setQueryData<Note[]>(qk.notes(cardId), (xs) => [n, ...(xs ?? [])]);
      setBody("");
      toast.success(internal ? "Staff-only note saved" : "Note synced to Planning Center");
    },
    onError: (e) => toast.error("Note not saved", { description: (e as Error).message }),
  });

  return (
    <div className="p-5">
      <div className="rounded-xl border border-line bg-canvas focus-within:border-accent/50">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Add a note…"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) add.mutate(); }}
          className="w-full resize-none bg-transparent px-3 py-2.5 text-sm placeholder:text-ink-faint focus:outline-none" />
        <div className="flex items-center justify-between border-t border-line px-2 py-1.5">
          <label className={clsx("flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs transition",
            internal ? "bg-warn-soft text-warn" : "text-ink-muted hover:text-ink-soft")}>
            <input type="checkbox" className="hidden" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            <Lock size={12} /> Staff-only {internal ? "(not sent to PCO)" : ""}
          </label>
          <button className="btn-primary px-2.5 py-1 text-xs" disabled={!body.trim() || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? <Spinner size={11} /> : null} Save <kbd className="opacity-60">⌘↵</kbd>
          </button>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {notes.isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-16" />)}
        {notes.data?.length === 0 && <div className="py-6 text-center text-sm text-ink-faint">No notes yet.</div>}
        {notes.data?.map((n) => (
          <div key={n.id} className="animate-fade-up rounded-lg border border-line bg-raised p-3">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] text-ink-muted">
              <Badge tone={SOURCE[n.source].tone}>{n.category && n.source === "profile" ? n.category : SOURCE[n.source].label}</Badge>
              <span className="font-medium text-ink-soft">{n.authorName}</span>
              <span className="ml-auto">{timeAgo(n.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{n.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const TEMPLATES = [
  { label: "Welcome", subject: (org: string) => `Great to meet you at ${org}!`, body: (n: string) => `Hi ${n},\n\nThanks so much for joining us on Sunday! We'd love to help you get connected. Is there anything we can pray about for you this week?\n\nSee you soon,` },
  { label: "Coffee invite", subject: () => "Coffee on us ☕", body: (n: string) => `Hi ${n},\n\nWe'd love to buy you a coffee and hear your story. Would any time this week work for you?\n\n` },
  { label: "Serve follow-up", subject: () => "Next steps for serving", body: (n: string) => `Hi ${n},\n\nThanks for your interest in serving! The next step is a quick conversation with a team leader. Reply with a couple of times that work and we'll set it up.\n\n` },
];

function EmailTab({ personId, cardId, firstName, email, onSent }: {
  personId: string; cardId: string; firstName: string; email: string | null; onSent: () => void;
}) {
  const qc = useQueryClient();
  const org = useQuery({ queryKey: qk.me, queryFn: Api.me, staleTime: Infinity }).data?.orgName ?? "church";
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => { setSubject(""); setBody(""); }, [cardId]);

  const send = useMutation({
    mutationFn: () => Api.email(personId, cardId, subject.trim(), body.trim()),
    onSuccess: () => {
      toast.success(`Email sent to ${firstName} via Planning Center`);
      qc.invalidateQueries({ queryKey: qk.notes(cardId) });
      onSent();
    },
    onError: (e) => toast.error("Email not sent", { description: (e as Error).message }),
  });

  if (!email) return <div className="p-5 text-sm text-ink-muted">No email address on this profile.</div>;

  return (
    <div className="space-y-3 p-5">
      <div className="text-xs text-ink-muted">To <span className="text-ink-soft">{email}</span> · sent from your Planning Center address and logged on the card</div>
      <div className="flex flex-wrap gap-1.5">
        {TEMPLATES.map((t) => (
          <button key={t.label} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft transition hover:border-accent/50 hover:text-accent"
            onClick={() => { setSubject(t.subject(org)); setBody(t.body(firstName)); }}>
            {t.label}
          </button>
        ))}
      </div>
      <input className="input" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea className="input min-h-[200px] resize-y leading-relaxed" placeholder="Write your message…" value={body} onChange={(e) => setBody(e.target.value)} />
      <button className="btn-primary w-full" disabled={!subject.trim() || !body.trim() || send.isPending} onClick={() => send.mutate()}>
        {send.isPending ? <Spinner /> : <Send size={14} />} Send email
      </button>
    </div>
  );
}
