"use client";
/** AVL leads: every possible job on a board, from first call to won or lost. Drag a card to move it. */
import clsx from "clsx";
import { BarChart3, CalendarClock, FileText, Hammer, LayoutGrid, List, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { LEAD_STAGES, leadName, type LeadRow, type LeadsBoard, type LeadStage } from "@shared/ops/crm";
import { fmtDate, money0, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Empty, ErrorBox, LeadStageBadge, Loading, PageHeader, Table } from "@/components/ops/OpsUi";
import { CloseLeadModal, NewLeadModal } from "@/components/avl/LeadModals";
import { dueInfo } from "@/components/avl/ActivityFeed";

export default function Page() { return <Suspense><Leads /></Suspense>; }

type Closing = { lead: LeadRow; stage: "WON" | "LOST"; position: number | null };

function Leads() {
  const sp = useSearchParams();
  const router = useRouter();
  const view = sp.get("view") === "list" ? "list" : "board";
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [adding, setAdding] = useState(sp.get("new") === "1");
  const params = new URLSearchParams({ ...(sp.get("q") ? { q: sp.get("q")! } : {}), ...(sp.get("closed") === "all" ? { closed: "all" } : {}) });
  const d = useOps<LeadsBoard>(`/leads?${params}`, { placeholderData: (p) => p });
  const go = (p: Record<string, string>) => {
    const n = new URLSearchParams({ view, q: sp.get("q") ?? "", closed: sp.get("closed") ?? "", ...p });
    for (const [k, v] of [...n.entries()]) if (!v || (k === "view" && v === "board")) n.delete(k);
    router.replace(`/avl/leads${n.size ? `?${n}` : ""}`);
  };
  const open = d.data?.leads.filter((l) => !["WON", "LOST"].includes(l.stage)) ?? [];

  return (
    <>
      <PageHeader crumb="AVL" title="Leads"
        description={d.data ? `${open.length} open · ${money0(open.reduce((s, l) => s + l.valueCents, 0))} in play` : "Every church you might work with, from the first call to won or lost."}
        actions={<>
          <Link href="/avl/leads/report" className="btn-outline"><BarChart3 size={15} /> Sources</Link>
          <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> New lead</button>
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {([["board", LayoutGrid, "Board"], ["list", List, "List"]] as const).map(([k, Icon, l]) => (
            <button key={k} onClick={() => go({ view: k })} className={clsx("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium", view === k ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-hover")}><Icon size={13} />{l}</button>
          ))}
        </div>
        <select className="input w-auto py-1.5 text-xs" value={sp.get("closed") === "all" ? "all" : ""} onChange={(e) => go({ closed: e.target.value })} aria-label="Closed leads">
          <option value="">Won & lost: last 90 days</option>
          <option value="all">Won & lost: all time</option>
        </select>
        <form className="ml-auto w-full sm:w-auto" onSubmit={(e) => { e.preventDefault(); go({ q }); }}>
          <input className="input sm:w-72" placeholder="Search lead, church, contact…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </div>
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : view === "board" ? <Board leads={d.data.leads} /> : <ListView leads={d.data.leads} />}
      {adding && d.data && <NewLeadModal customers={d.data.customers} people={d.data.people} sources={d.data.sources} presetClient={sp.get("client")} onClose={() => setAdding(false)} />}
    </>
  );
}

/** Where a card dropped at `index` of a column goes: halfway between its new neighbours. */
function positionAt(col: LeadRow[], index: number) {
  const before = col[index - 1]?.position, after = col[index]?.position;
  if (before == null && after == null) return 0;
  if (before == null) return after! - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}

function Board({ leads }: { leads: LeadRow[] }) {
  const refresh = useOpsRefresh();
  const [moved, setMoved] = useState<Record<string, { stage: LeadStage; position: number }>>({});
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ stage: LeadStage; index: number } | null>(null);
  const [closing, setClosing] = useState<Closing | null>(null);
  const cols = useMemo(() => {
    const all = leads.map((l) => (moved[l.id] ? { ...l, ...moved[l.id] } : l));
    return Object.fromEntries(LEAD_STAGES.map((s) => [s.id, all.filter((l) => l.stage === s.id).sort((a, b) => a.position - b.position)])) as Record<LeadStage, LeadRow[]>;
  }, [leads, moved]);
  const colRefs = useRef<Partial<Record<LeadStage, HTMLDivElement | null>>>({});

  const indexAt = (stage: LeadStage, y: number) => {
    const el = colRefs.current[stage];
    const cards = el ? [...el.querySelectorAll<HTMLElement>("[data-card]")].filter((c) => c.dataset.card !== drag) : [];
    const i = cards.findIndex((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
    return i < 0 ? cards.length : i;
  };
  const drop = async (stage: LeadStage) => {
    const id = drag, at = over;
    setDrag(null); setOver(null);
    if (!id || !at) return;
    const lead = leads.find((l) => l.id === id)!;
    const col = cols[stage].filter((l) => l.id !== id);
    const position = positionAt(col, at.index);
    const cur = moved[id] ?? lead;
    if (cur.stage === stage && cur.position === position) return;
    if ((stage === "WON" || stage === "LOST") && cur.stage !== stage) { setClosing({ lead: { ...lead, ...cur }, stage, position }); return; }
    setMoved((m) => ({ ...m, [id]: { stage, position } }));
    try { await ops(`/leads/${id}/move`, { json: { stage, position } }); await refresh(); }
    catch (e) { toast.error((e as Error).message); setMoved((m) => { const n = { ...m }; delete n[id]; return n; }); }
  };

  const zone = (stage: LeadStage, empty: string, minH: string) => {
    const col = cols[stage];
    return (
      <div ref={(el) => { colRefs.current[stage] = el; }} className={clsx("flex flex-col gap-2 px-2 pb-2", minH)}>
        {col.map((l, i) => (
          <div key={l.id}>
            {over?.stage === stage && over.index === i && drag !== l.id && <DropLine />}
            <LeadCard lead={l} dragging={drag === l.id} onDragStart={() => setDrag(l.id)} onDragEnd={() => { setDrag(null); setOver(null); }} />
          </div>
        ))}
        {over?.stage === stage && over.index >= col.filter((l) => l.id !== drag).length && <DropLine />}
        {!col.length && over?.stage !== stage && <div className="grid flex-1 place-items-center py-5 text-center text-[11px] text-ink-faint">{empty}</div>}
      </div>
    );
  };
  /** The whole column (header included) takes the drop. */
  const dropProps = (stage: LeadStage) => ({
    onDragOver: (e: React.DragEvent) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; const index = indexAt(stage, e.clientY); if (over?.stage !== stage || over.index !== index) setOver({ stage, index }); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o?.stage === stage ? null : o)); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); void drop(stage); },
  });
  const head = (stage: LeadStage) => (
    <div className="flex items-baseline gap-2 px-3 pb-2 pt-3">
      <LeadStageBadge stage={stage} />
      <span className="text-xs tabular-nums text-ink-faint">{cols[stage].length}</span>
      <span className="ml-auto font-mono text-[11px] text-ink-muted">{money0(cols[stage].reduce((t, l) => t + l.valueCents, 0))}</span>
    </div>
  );

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="flex gap-3">
          {LEAD_STAGES.filter((s) => s.open).map((s) => (
            <div key={s.id} {...dropProps(s.id)} className={clsx("flex min-w-[200px] flex-1 basis-0 flex-col rounded-xl border transition", over?.stage === s.id ? "border-accent bg-accent-soft/20" : "border-line bg-hover/30")}>
              {head(s.id)}
              {zone(s.id, s.id === "NEW" ? "New leads land here" : "Drag a lead here", "min-h-[140px] flex-1")}
            </div>
          ))}
          {/* Won and lost share a column: they're where leads end, not where work happens. */}
          <div className="flex min-w-[200px] flex-1 basis-0 flex-col gap-3">
            {(["WON", "LOST"] as const).map((st) => (
              <div key={st} {...dropProps(st)} className={clsx("flex flex-col rounded-xl border transition", over?.stage === st ? "border-accent bg-accent-soft/20" : st === "WON" ? "border-ok/30 bg-ok-soft/30" : "border-line bg-hover/20")}>
                {head(st)}
                {zone(st, st === "WON" ? "Drag here when they say yes" : "Drag here when it's a no", "min-h-[64px]")}
              </div>
            ))}
          </div>
        </div>
      </div>
      {closing && <CloseLeadModal lead={closing.lead} stage={closing.stage} position={closing.position} onClose={() => setClosing(null)} />}
    </>
  );
}

const DropLine = () => <div className="my-0.5 h-0.5 rounded-full bg-accent" />;

function LeadCard({ lead: l, dragging, onDragStart, onDragEnd }: { lead: LeadRow; dragging: boolean; onDragStart: () => void; onDragEnd: () => void }) {
  const router = useRouter();
  const due = l.nextFollowUp ? dueInfo(l.nextFollowUp.dueAt) : null;
  return (
    <div data-card={l.id} draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", l.id); onDragStart(); }} onDragEnd={onDragEnd}
      onClick={() => router.push(`/avl/leads/view?id=${l.id}`)}
      className={clsx("panel cursor-grab select-none p-3 text-sm shadow-sm transition hover:border-line-strong active:cursor-grabbing", dragging && "opacity-40")}>
      <div className="font-medium leading-snug">{l.title}</div>
      <div className="mt-0.5 truncate text-xs text-ink-muted">{leadName(l)}{l.city ? ` · ${l.city}` : ""}</div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs font-medium">{l.valueCents ? money0(l.valueCents) : <span className="text-ink-faint">—</span>}</span>
        {l.quote && <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-hover px-1.5 py-0.5 text-[10px] text-ink-soft" title={`Proposal ${l.quote.number}`}><FileText size={10} />{l.quote.number.split("-").pop()}</span>}
        {l.job && <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-ok-soft px-1.5 py-0.5 text-[10px] text-ok" title={`Job ${l.job.number}`}><Hammer size={10} />{l.job.number}</span>}
        {l.owner && <span className="ml-auto grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent" title={l.owner.name}>{initials(l.owner.name)}</span>}
      </div>
      {(due || l.stage === "LOST") && (
        <div className="mt-2 border-t border-line pt-2 text-[11px]">
          {l.stage === "LOST" ? <span className="block truncate text-ink-faint">{l.lostReason ?? "Lost"}</span> : due && (
            <span className={clsx("flex min-w-0 items-center gap-1", due.tone === "bad" ? "text-bad" : due.tone === "warn" ? "text-warn" : "text-ink-muted")} title={l.nextFollowUp!.body}>
              <CalendarClock size={11} className="shrink-0" /><span className="shrink-0 whitespace-nowrap">{due.label}:</span><span className="min-w-0 truncate text-ink-soft">{l.nextFollowUp!.body}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function ListView({ leads }: { leads: LeadRow[] }) {
  const router = useRouter();
  const order = (s: LeadStage) => LEAD_STAGES.findIndex((x) => x.id === s);
  const rows = [...leads].sort((a, b) => order(a.stage) - order(b.stage) || a.position - b.position);
  return (
    <Card>
      {rows.length ? (
        <Table min={920} head={<tr><th>Lead</th><th>Stage</th><th className="text-right">Worth</th><th>Next follow-up</th><th>Owner</th><th>Came from</th><th>Updated</th></tr>}>
          {rows.map((l) => {
            const due = l.nextFollowUp ? dueInfo(l.nextFollowUp.dueAt) : null;
            return (
              <tr key={l.id} className="cursor-pointer" onClick={() => router.push(`/avl/leads/view?id=${l.id}`)}>
                <td><div className="font-medium">{l.title}</div><div className="text-[11px] text-ink-faint">{leadName(l)}{l.city ? ` · ${l.city}` : ""}</div></td>
                <td><LeadStageBadge stage={l.stage} /></td>
                <td className="text-right font-mono">{money0(l.valueCents)}</td>
                <td className="text-xs">{due ? <span className={due.tone === "bad" ? "text-bad" : due.tone === "warn" ? "text-warn" : "text-ink-soft"}>{due.label}</span> : <span className="text-ink-faint">—</span>}</td>
                <td className="text-ink-soft">{l.owner?.name ?? "—"}</td>
                <td className="text-ink-soft">{l.source ?? "—"}</td>
                <td className="text-xs text-ink-muted">{fmtDate(l.updatedAt)}</td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No leads yet. Add one with New lead.</Empty>}
    </Card>
  );
}
