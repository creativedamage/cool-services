"use client";
/**
 * Parent paging inside the app: today's Nursery and Kids children, one tap to page, plus the
 * code box for anyone else. Same on-screen lock as the iPads.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { BellRing, Search, Settings2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { KioskChild, Ministry } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { clock } from "@/lib/format";
import { Avatar, Skeleton, Spinner } from "@/components/ui";
import { PagerBar, usePager } from "@/components/paging/Pager";
import { PrefsLink } from "@/components/settings/PrefsLink";

export default function PagingPage() {
  const pager = usePager();
  const kids = useQuery({ queryKey: qk.pagingChildren, queryFn: Api.pagingChildren, refetchInterval: 10_000 });
  const [q, setQ] = useState("");
  const cfg = pager.config.data;
  const ministries = (["nursery", "kids"] as Ministry[]).filter((m) => cfg?.ministries[m].enabled);

  const filter = (list: KioskChild[]) => {
    const s = q.trim().toLowerCase();
    return list.filter((c) => !s || c.name.toLowerCase().includes(s) || c.securityCode?.toLowerCase() === s || c.room.toLowerCase().includes(s));
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Parent paging</h1>
          <p className="mt-1 text-sm text-ink-muted">Shows a child’s tag code on the auditorium screens through ProPresenter.</p>
        </div>
        <PrefsLink section="paging" className="btn-ghost ml-auto py-1 text-xs"><Settings2 size={13} /> Paging settings</PrefsLink>
      </div>

      <div className="mt-5"><PagerBar pager={pager} /></div>

      {pager.ready && (
        <>
          <div className="relative mt-5 w-72">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="input py-1.5 pl-8" placeholder="Find a child, room or code" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {ministries.map((m) => (
              <MinistryList key={m} title={cfg!.ministries[m].title} noRooms={!cfg!.ministries[m].locationIds.length}
                list={kids.data ? filter(kids.data[m] ?? []) : null} error={kids.error as Error | null}
                pager={pager} ministry={m} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MinistryList({ title, list, error, pager, ministry, noRooms }: {
  title: string; list: KioskChild[] | null; error: Error | null; pager: ReturnType<typeof usePager>; ministry: Ministry; noRooms: boolean;
}) {
  const locked = pager.left > 0;
  const rooms = useMemo(() => [...new Set((list ?? []).map((c) => c.room))], [list]);
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="text-sm font-semibold">{title}</div>
        <span className="text-xs text-ink-muted">{list ? `${list.length} here${rooms.length ? ` · ${rooms.join(", ")}` : ""}` : ""}</span>
      </header>
      {error ? <p className="p-4 text-sm text-bad">{error.message}</p>
        : !list ? <div className="p-4"><Skeleton className="h-24" /></div>
        : noRooms ? <p className="p-4 text-sm text-ink-muted">Choose {title}’s Check-Ins rooms in <PrefsLink className="text-accent underline" section="paging">Preferences → Network Connections</PrefsLink>.</p>
        : list.length === 0 ? <p className="p-4 text-sm text-ink-muted">No children checked in yet today.</p>
        : (
          <ul className="divide-y divide-line/60">
            {list.map((c) => {
              const busy = pager.page.isPending && pager.page.variables?.code === c.securityCode;
              return (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                  <Avatar name={c.name} src={c.avatarUrl} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="truncate text-[11px] text-ink-muted">{c.room}{c.guest ? " · Guest" : ""} · {clock(c.at)}</div>
                  </div>
                  {c.securityCode && <span className="rounded bg-hover px-1.5 font-mono text-xs text-ink-soft">{c.securityCode}</span>}
                  <button disabled={!c.securityCode || locked || pager.page.isPending}
                    onClick={() => pager.page.mutate({ ministry, code: c.securityCode!, childName: c.name })}
                    className={clsx("inline-flex w-[88px] items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs transition disabled:opacity-40",
                      "border-line text-ink-soft hover:border-accent/50 hover:text-accent")}>
                    {busy ? <Spinner size={11} /> : <BellRing size={12} />} {locked ? `${pager.left}s` : "Page"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
    </section>
  );
}
