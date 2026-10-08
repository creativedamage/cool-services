"use client";
/** Where leads come from, and which sources turn into work. */
import clsx from "clsx";
import { useState } from "react";
import type { LeadReport } from "@shared/ops/crm";
import { fmtDate, fmtPct, money0, useOps } from "@/lib/ops";
import { Card, Empty, ErrorBox, KpiRow, Loading, PageHeader, Table } from "@/components/ops/OpsUi";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const RANGES = [
  { key: "year", label: "This year", since: () => `${new Date().getFullYear()}-01-01` },
  { key: "12m", label: "Last 12 months", since: () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return ymd(d); } },
  { key: "all", label: "All time", since: () => "2000-01-01" },
];

export default function Report() {
  const [range, setRange] = useState("year");
  const since = RANGES.find((r) => r.key === range)!.since();
  const d = useOps<LeadReport>(`/leads/report?since=${since}`, { placeholderData: (p) => p });
  const t = d.data?.total;
  const best = d.data?.sources.reduce((m, s) => (s.wonCents > (m?.wonCents ?? 0) ? s : m), null as LeadReport["sources"][number] | null);
  return (
    <>
      <PageHeader crumb="AVL / Leads" title="Lead sources" description={`Leads added ${range === "all" ? "ever" : `since ${fmtDate(since + "T12:00")}`}, by where they came from.`}
        actions={<div className="inline-flex rounded-lg border border-line p-0.5">
          {RANGES.map((r) => <button key={r.key} onClick={() => setRange(r.key)} className={clsx("rounded-md px-3 py-1.5 text-xs font-medium", range === r.key ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-hover")}>{r.label}</button>)}
        </div>} />
      <ErrorBox error={d.error} />
      {!d.data || !t ? (!d.error && <Loading />) : (
        <div className="space-y-5">
          <KpiRow items={[
            { value: String(t.leads), label: "Leads" },
            { value: money0(t.wonCents), label: "Won", tone: "ok" },
            { value: t.won + t.lost ? fmtPct(t.winRateBps) : "—", label: "Win rate (of closed leads)" },
            { value: best?.source ?? "—", label: "Brings in the most work" },
          ]} />
          <Card eyebrow="Sources" title="Won by source">
            {d.data.sources.length ? (
              <Table min={720} head={<tr><th>Came from</th><th className="text-right">Leads</th><th className="text-right">Open</th><th className="text-right">Won</th><th className="text-right">Lost</th><th className="text-right">Win rate</th><th className="text-right">Won value</th><th className="w-40" /></tr>}>
                {d.data.sources.map((s) => (
                  <tr key={s.source}>
                    <td className="font-medium">{s.source}</td>
                    <td className="text-right tabular-nums">{s.leads}</td>
                    <td className="text-right tabular-nums text-ink-soft">{s.open}</td>
                    <td className="text-right tabular-nums text-ok">{s.won}</td>
                    <td className="text-right tabular-nums text-ink-muted">{s.lost}</td>
                    <td className="text-right tabular-nums">{s.won + s.lost ? fmtPct(s.winRateBps) : "—"}</td>
                    <td className="text-right font-mono">{money0(s.wonCents)}</td>
                    <td><div className="h-1.5 rounded-full bg-hover"><div className="h-1.5 rounded-full bg-ok" style={{ width: `${t.wonCents ? Math.round((s.wonCents / t.wonCents) * 100) : 0}%` }} /></div></td>
                  </tr>
                ))}
              </Table>
            ) : <Empty>No leads in this range yet.</Empty>}
          </Card>
          <p className="text-[11px] text-ink-faint">Won value is what each lead was worth when it was won. Win rate counts only leads that are closed (won or lost).</p>
        </div>
      )}
    </>
  );
}
