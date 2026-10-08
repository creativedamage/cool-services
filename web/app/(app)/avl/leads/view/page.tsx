"use client";
/** One lead: where it stands, who it's with, its timeline and what's next. */
import clsx from "clsx";
import { Check, FileText, Hammer, Mail, Pencil, Phone, Plus, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { LEAD_STAGES, leadName, stageIndex, type LeadPage, type LeadStage } from "@shared/ops/crm";
import { fmtDate, money0, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { useOpsUser } from "@/components/ops/context";
import { Card, ErrorBox, LeadStageBadge, Loading, PageHeader, QuoteStatusBadge } from "@/components/ops/OpsUi";
import { Spinner } from "@/components/ui";
import { ActivityFeed } from "@/components/avl/ActivityFeed";
import { CloseLeadModal, EditLeadModal } from "@/components/avl/LeadModals";
import type { QuoteStatus } from "@shared/ops/state-machine";

export default function Page() { return <Suspense><Lead /></Suspense>; }

function Lead() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const me = useOpsUser();
  const refresh = useOpsRefresh();
  const d = useOps<LeadPage>(id ? `/leads/${id}` : null);
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState<"WON" | "LOST" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!d.data) return <><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  const { lead: l, people, customers, sources } = d.data;
  const closed = l.stage === "WON" || l.stage === "LOST";

  const move = async (stage: LeadStage) => {
    if (stage === l.stage) return;
    if (stage === "WON" || stage === "LOST") { setClosing(stage); return; }
    setBusy(stage);
    try { await ops(`/leads/${l.id}/move`, { json: { stage } }); await refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const proposal = async () => {
    setBusy("proposal");
    try {
      const q = await ops<{ id: string; created: boolean }>(`/leads/${l.id}/proposal`, { method: "POST" });
      await refresh();
      if (q.created) toast.success(l.customer ? "Proposal started" : `${leadName(l)} is now a client, and the proposal is started`);
      router.push(`/avl/quotes/view?id=${q.id}`);
    } catch (e) { toast.error((e as Error).message); setBusy(null); }
  };

  return (
    <>
      <PageHeader crumb="AVL / Leads" title={l.title}
        description={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {l.customer ? <Link href={`/avl/clients/view?id=${l.customer.id}`} className="text-accent hover:underline">{l.customer.name}</Link> : <span>{leadName(l)} <span className="text-ink-faint">(not a client yet)</span></span>}
          {(l.city || l.state) && <span>{[l.city, l.state].filter(Boolean).join(", ")}</span>}
          <LeadStageBadge stage={l.stage} />
        </span>}
        actions={<>
          <button className="btn-outline" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
          {l.job ? <Link href={`/avl/jobs/view?id=${l.job.id}`} className="btn-primary"><Hammer size={15} /> Open job {l.job.number}</Link>
            : l.quote ? <Link href={`/avl/quotes/view?id=${l.quote.id}`} className="btn-primary"><FileText size={15} /> Open proposal</Link>
            : !closed && <button className="btn-primary" onClick={proposal} disabled={!!busy}>{busy === "proposal" ? <Spinner /> : <Plus size={15} />} Start proposal</button>}
        </>} />

      <Stepper stage={l.stage} busy={busy} onMove={move} />

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <ActivityFeed target={{ leadId: l.id }} people={people} title="Timeline" eyebrow="Activity & follow-ups" />
        <div className="space-y-5">
          <Card eyebrow="Lead" title="At a glance">
            <dl className="divide-y divide-line text-sm">
              <Row k="Worth about"><span className="font-mono font-medium">{l.valueCents ? money0(l.valueCents) : "—"}</span></Row>
              <Row k="Owner">{l.owner?.name ?? <span className="text-ink-faint">Nobody yet</span>}</Row>
              <Row k="Came from">{l.source ?? "—"}</Row>
              <Row k="Expect to decide">{l.expectedClose ? fmtDate(l.expectedClose + "T12:00") : "—"}</Row>
              {l.quote && <Row k="Proposal"><Link href={`/avl/quotes/view?id=${l.quote.id}`} className="mr-2 font-mono text-xs text-accent hover:underline">{l.quote.number}</Link><QuoteStatusBadge status={l.quote.status as QuoteStatus} /></Row>}
              {l.job && <Row k="Job"><Link href={`/avl/jobs/view?id=${l.job.id}`} className="font-mono text-xs text-accent hover:underline">{l.job.number}</Link></Row>}
              {l.stage === "WON" && l.wonAt && <Row k="Won">{fmtDate(l.wonAt)}</Row>}
              {l.stage === "LOST" && <Row k="Lost">{l.lostAt ? fmtDate(l.lostAt) : ""}{l.lostReason && <div className="text-xs text-ink-muted">{l.lostReason}</div>}</Row>}
              <Row k="Added">{fmtDate(l.createdAt)}{l.createdBy ? ` by ${l.createdBy}` : ""}</Row>
            </dl>
          </Card>
          {(l.contactName || l.contactEmail || l.contactPhone) && (
            <Card eyebrow="People" title="Contact">
              <div className="space-y-1 p-4 text-sm">
                {l.contactName && <div className="font-medium">{l.contactName}</div>}
                {l.contactEmail && <a href={`mailto:${l.contactEmail}`} className="flex items-center gap-1.5 text-accent hover:underline"><Mail size={12} />{l.contactEmail}</a>}
                {l.contactPhone && <a href={`tel:${l.contactPhone}`} className="flex items-center gap-1.5 text-ink-soft hover:text-ink"><Phone size={12} />{l.contactPhone}</a>}
                {l.customer && <p className="pt-2 text-[11px] text-ink-faint">The client&apos;s own contacts are on <Link href={`/avl/clients/view?id=${l.customer.id}`} className="text-accent hover:underline">its page</Link>.</p>}
              </div>
            </Card>
          )}
          {l.notes && <Card eyebrow="Notes" title="Background"><p className="whitespace-pre-wrap p-4 text-sm text-ink-soft">{l.notes}</p></Card>}
          {(l.createdById === me.user.id || me.nav.avlManager) && (
            <button className="btn-ghost text-xs text-bad" onClick={async () => {
              if (!confirm(`Delete “${l.title}” and its timeline? Its client, proposal and job stay.`)) return;
              try { await ops(`/leads/${l.id}`, { method: "DELETE" }); await refresh(); toast.success("Lead deleted"); router.push("/avl/leads"); } catch (e) { toast.error((e as Error).message); }
            }}><Trash2 size={13} /> Delete lead</button>
          )}
        </div>
      </div>
      {editing && <EditLeadModal lead={l} customers={customers} people={people} sources={sources} onClose={() => setEditing(false)} />}
      {closing && <CloseLeadModal lead={l} stage={closing} onClose={() => setClosing(null)} />}
    </>
  );
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-3 px-4 py-2.5"><dt className="shrink-0 text-ink-muted">{k}</dt><dd className="min-w-0 text-right">{children}</dd></div>
);

const SHORT: Partial<Record<LeadStage, string>> = { NEW: "New", CONTACTED: "Contacted", SITE_VISIT: "Visit", PROPOSAL: "Proposal" };

/** The stages as steps: click one to move there. Won and lost sit apart. */
function Stepper({ stage, busy, onMove }: { stage: LeadStage; busy: string | null; onMove: (s: LeadStage) => void }) {
  const at = stageIndex(stage);
  const open = LEAD_STAGES.filter((s) => s.open);
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <div className="flex w-full min-w-0 overflow-hidden rounded-xl border border-line sm:w-auto sm:flex-1">
        {open.map((s, i) => {
          const done = stage === "WON" || (stage !== "LOST" && i < at);
          const here = s.id === stage;
          return (
            <button key={s.id} onClick={() => onMove(s.id)} disabled={!!busy}
              className={clsx("flex min-w-0 flex-1 items-center justify-center gap-1.5 border-r border-line px-2 py-2.5 text-xs font-medium transition last:border-r-0",
                here ? "bg-accent text-on-accent" : done ? "bg-accent-soft text-accent hover:bg-accent/20" : "text-ink-muted hover:bg-hover")}>
              {busy === s.id ? <Spinner /> : done && <Check size={12} className="shrink-0" />}<span className="truncate sm:hidden">{SHORT[s.id]}</span><span className="hidden truncate sm:inline">{s.label}</span>
            </button>
          );
        })}
      </div>
      <button onClick={() => onMove("WON")} disabled={!!busy} className={clsx("inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-xs font-medium transition sm:flex-none sm:py-0", stage === "WON" ? "border-ok bg-ok text-white" : "border-line text-ok hover:bg-ok-soft")}><ThumbsUp size={13} /> Won</button>
      <button onClick={() => onMove("LOST")} disabled={!!busy} className={clsx("inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-xs font-medium transition sm:flex-none sm:py-0", stage === "LOST" ? "border-ink-faint bg-hover text-ink" : "border-line text-ink-muted hover:bg-hover")}><ThumbsDown size={13} /> Lost</button>
    </div>
  );
}
