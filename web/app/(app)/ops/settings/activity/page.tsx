"use client";
/** Who did what, and when. */
import Link from "next/link";
import { useState } from "react";
import type { ActivityRow } from "@shared/ops/types";
import { fmtDateTime, useOps } from "@/lib/ops";
import { activityHref, Card, Empty, ErrorBox, Loading, PageHeader, Pill, Tabs } from "@/components/ops/OpsUi";

const LABEL = { "": "All", AUTH: "Sign-ins", REQUESTS: "Requests", AVL: "AVL", ADMIN: "Admin" } as const;
type A = keyof typeof LABEL;

export default function Activity() {
  const [area, setArea] = useState<A>("");
  const [page, setPage] = useState(1);
  const d = useOps<{ rows: ActivityRow[]; total: number; page: number; per: number }>(`/settings/activity?${new URLSearchParams({ ...(area ? { area } : {}), page: String(page) })}`, { placeholderData: (p) => p });
  return (
    <>
      <PageHeader crumb="Settings" title="Activity" description="Who did what, and when: requests, AVL and admin changes." />
      <div className="mb-4"><Tabs<A> value={area} onChange={(a) => { setArea(a); setPage(1); }} items={(Object.keys(LABEL) as A[]).map((k) => ({ key: k, label: LABEL[k] }))} /></div>
      <ErrorBox error={d.error} />
      {!d.data ? (!d.error && <Loading />) : (
        <Card eyebrow="Accountability" title={`${d.data.total.toLocaleString()} events`}>
          {d.data.rows.length ? (
            <ul className="divide-y divide-line">
              {d.data.rows.map((a) => (
                <li key={a.id} className="grid gap-1 px-4 py-2.5 text-[13px] lg:grid-cols-[170px_90px_240px_1fr] lg:gap-4">
                  <span className="text-ink-muted">{a.actorName ?? a.actorLabel ?? "System"}</span>
                  <span><Pill tone="muted">{LABEL[a.area as A] ?? a.area}</Pill></span>
                  <span className="font-medium">{a.href ? <Link href={activityHref(a.href)!} className="hover:text-accent">{a.action}</Link> : a.action}</span>
                  <span className="text-ink-faint">{fmtDateTime(a.createdAt)}{a.detail && ` · ${a.detail}`}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No activity.</Empty>}
          {d.data.total > d.data.per && (
            <div className="flex justify-between border-t border-line px-4 py-3 text-xs">
              {page > 1 ? <button className="text-accent hover:underline" onClick={() => setPage(page - 1)}>← Newer</button> : <span />}
              {page * d.data.per < d.data.total && <button className="text-accent hover:underline" onClick={() => setPage(page + 1)}>Older →</button>}
            </div>
          )}
        </Card>
      )}
    </>
  );
}
