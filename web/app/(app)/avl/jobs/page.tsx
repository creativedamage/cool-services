"use client";
/** AVL jobs: every project, from a signed proposal or started by hand, with what it's worth. */
import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { JOB_STATUSES, type JobsList, type JobStatus } from "@shared/ops/jobs";
import { fmtDate, fmtPct, money0, ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Check, Empty, ErrorBox, Field, JobStatusBadge, Loading, PageHeader, Table } from "@/components/ops/OpsUi";
import { Modal, Spinner } from "@/components/ui";

export default function Page() { return <Suspense><Jobs /></Suspense>; }

const SHOW: { key: string; label: string; statuses: JobStatus[] | null }[] = [
  { key: "open", label: "Open", statuses: ["PLANNING", "IN_PROGRESS", "ON_HOLD"] },
  { key: "COMPLETE", label: "Complete", statuses: ["COMPLETE"] },
  { key: "CANCELLED", label: "Cancelled", statuses: ["CANCELLED"] },
  { key: "all", label: "All", statuses: null },
];

function Jobs() {
  const sp = useSearchParams();
  const router = useRouter();
  const show = sp.get("show") ?? "open";
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [adding, setAdding] = useState(sp.get("new") === "1");
  const params = new URLSearchParams({ ...(show !== "all" ? { status: show } : {}), ...(sp.get("q") ? { q: sp.get("q")! } : {}) });
  const d = useOps<JobsList>(`/jobs?${params}`, { placeholderData: (p) => p });
  const church = d.data?.businessType === "CHURCH";
  const go = (p: Record<string, string>) => {
    const n = new URLSearchParams({ show, q: sp.get("q") ?? "", ...p });
    for (const [k, v] of [...n.entries()]) if (!v || (k === "show" && v === "open")) n.delete(k);
    router.replace(`/avl/jobs${n.size ? `?${n}` : ""}`);
  };
  const count = (s: (typeof SHOW)[number]) => (d.data && s.statuses ? s.statuses.reduce((a, x) => a + (d.data!.counts[x] ?? 0), 0) : null);

  return (
    <>
      <PageHeader crumb="AVL" title="Jobs"
        description={church ? "Your team's projects, each with its budget." : "Every project you're running: made from a signed proposal, or started by hand."}
        actions={<button className="btn-primary" onClick={() => setAdding(true)}><Plus size={15} /> New job</button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {SHOW.map((s) => (
            <button key={s.key} onClick={() => go({ show: s.key })} className={clsx("rounded-md px-3 py-1.5 text-xs font-medium", show === s.key ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-hover")}>
              {s.label}{count(s) != null && <span className={clsx("ml-1.5 tabular-nums", show === s.key ? "opacity-80" : "text-accent")}>{count(s)}</span>}
            </button>
          ))}
        </div>
        <form className="ml-auto w-full sm:w-auto" onSubmit={(e) => { e.preventDefault(); go({ q }); }}>
          <input className="input sm:w-72" placeholder={church ? "Search job or place…" : "Search job, client, address…"} value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </div>
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <Card>
          {d.data.jobs.length ? (
            <Table min={900} head={<tr><th>Job</th>{!church && <th>Client</th>}<th>Status</th><th>Dates</th><th className="text-right">{church ? "Budget" : "Price"}</th><th className="text-right">Cost</th>{!church && <th className="text-right">Margin</th>}</tr>}>
              {d.data.jobs.map((j) => (
                <tr key={j.id} className="cursor-pointer" onClick={() => router.push(`/avl/jobs/view?id=${j.id}`)}>
                  <td>
                    <Link href={`/avl/jobs/view?id=${j.id}`} className="font-medium hover:text-accent" onClick={(e) => e.stopPropagation()}>{j.name}</Link>
                    <div className="text-[11px] text-ink-faint"><span className="font-mono">{j.number}</span>{j.siteLine1 || j.siteCity ? ` · ${[j.siteLine1, j.siteCity].filter(Boolean).join(", ")}` : ""}{j.quote ? ` · from ${j.quote.number}` : ""}</div>
                  </td>
                  {!church && <td className="text-ink-soft">{j.customer?.name ?? <span className="text-ink-faint">—</span>}</td>}
                  <td><JobStatusBadge status={j.status} /></td>
                  <td className="whitespace-nowrap text-xs text-ink-muted">{j.startDate ? `${fmtDate(j.startDate + "T12:00")}${j.endDate ? ` – ${fmtDate(j.endDate + "T12:00")}` : ""}` : "—"}</td>
                  <td className="text-right font-mono">{money0(church ? j.costCents : j.priceCents)}</td>
                  <td className="text-right font-mono text-ink-soft">{church ? "—" : money0(j.costCents)}</td>
                  {!church && <td className={clsx("text-right font-mono", j.priceCents > 0 && (j.marginBps < 1500 ? "text-bad" : j.marginBps < 2500 ? "text-warn" : "text-ok"))}>{j.priceCents > 0 ? fmtPct(j.marginBps) : "—"}</td>}
                </tr>
              ))}
            </Table>
          ) : <Empty>{sp.get("q") ? "No jobs match." : show === "open" ? (church ? "No open projects. Start one with New job." : "No open jobs. A signed proposal becomes a job from its page, or start one with New job.") : "Nothing here."}</Empty>}
        </Card>
      )}
      {adding && d.data && <NewJob church={church} customers={d.data.customers} onClose={() => setAdding(false)} />}
    </>
  );
}

function NewJob({ church, customers, onClose }: { church: boolean; customers: { id: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const refresh = useOpsRefresh();
  const [f, setF] = useState({ name: "", customerId: "", siteLine1: "", siteCity: "", siteState: "", startDate: "", endDate: "", groups: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <Modal open onClose={onClose} title="New job" width={560}>
      <form className="space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          const { groups, ...rest } = f;
          const j = await ops<{ id: string }>("/jobs", { json: { ...rest, startWithGroups: groups } });
          void refresh();
          router.push(`/avl/jobs/view?id=${j.id}`);
        } catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <Field label="Job name"><input required autoFocus className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={church ? "e.g. Youth room lighting" : "e.g. Sanctuary audio refresh"} /></Field>
        {!church && (
          <Field label="Client" hint="Optional. Jobs from a signed proposal fill this in for you.">
            <select className="input" value={f.customerId} onChange={(e) => set({ customerId: e.target.value })}>
              <option value="">No client</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-[2fr_1.4fr_0.6fr]">
          <Field label={church ? "Where" : "Site address"}><input className="input" value={f.siteLine1} onChange={(e) => set({ siteLine1: e.target.value })} placeholder={church ? "Room or building" : "Street"} /></Field>
          <Field label="City"><input className="input" value={f.siteCity} onChange={(e) => set({ siteCity: e.target.value })} /></Field>
          <Field label="State"><input className="input" value={f.siteState} onChange={(e) => set({ siteState: e.target.value })} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts"><input type="date" className="input" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Ends"><input type="date" className="input" value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>
        </div>
        <Check label="Start the budget with the usual cost groups" hint="Design, Audio, Video, Lighting, Control, Infrastructure, Labor, Programming, Training. Remove any you don't need." checked={f.groups} onChange={(v) => set({ groups: v })} />
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy && <Spinner />}Create job</button>
        </div>
      </form>
    </Modal>
  );
}
