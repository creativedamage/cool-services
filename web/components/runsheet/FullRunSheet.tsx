"use client";
/**
 * The whole-page run sheet (in the spirit of ScriptViewer): every item with its clock time, length,
 * description and each note category in its own column. Pick a layout for a team (Lighting, Video…)
 * to put that team's notes first and highlight the items that have them. Follows Planning Center
 * Live (current item, next item, time on the current item) and refreshes on its own.
 *
 * Keys: F full screen · + / − text size · L follow live · P print · Esc leave full screen.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, Film, Maximize2, Minimize2, Minus, Music2, Plus, Printer, Radio, Type } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlanItem } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { clock, mmss } from "@/lib/format";
import { routes } from "@/lib/routes";
import { Skeleton } from "@/components/ui";

const PALETTE = ["#60A5FA", "#34D399", "#F59E0B", "#F472B6", "#A78BFA", "#22D3EE", "#FB7185", "#A3E635", "#FBBF24", "#818CF8"];
const LS = "coolservices.runsheet";
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(`${LS}.${k}`); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const keep = (k: string, v: unknown) => { try { localStorage.setItem(`${LS}.${k}`, JSON.stringify(v)); } catch { /* ignore */ } };

export function FullRunSheet({ serviceTypeId, planId, kioskStart }: { serviceTypeId: string; planId: string; kioskStart?: boolean }) {
  const data = useQuery({ queryKey: qk.runSheet(planId), queryFn: () => Api.runSheet(serviceTypeId, planId), refetchInterval: 10_000, refetchIntervalInBackground: true });
  const live = useQuery({ queryKey: qk.live(planId), queryFn: () => Api.live(serviceTypeId, planId), refetchInterval: 3_000, refetchIntervalInBackground: true, retry: false });

  const [layout, setLayout] = useState<string>(() => load("layout", "all"));
  const [size, setSize] = useState<number>(() => load("size", 15));
  const [follow, setFollow] = useState<boolean>(() => load("follow", true));
  const [timeId, setTimeId] = useState<string | null>(null);
  const [kiosk, setKiosk] = useState(Boolean(kioskStart));
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => keep("layout", layout), [layout]);
  useEffect(() => keep("size", size), [size]);
  useEffect(() => keep("follow", follow), [follow]);

  const plan = data.data?.plan;
  const serviceTimes = (plan?.times ?? []).filter((t) => t.kind === "service");
  const time = serviceTimes.find((t) => t.id === timeId)
    // Default: the service time happening now or next.
    ?? serviceTimes.find((t) => Date.parse(t.endsAt || t.startsAt) > now) ?? serviceTimes[0];

  /** Every note category used in this plan, in first-seen order, with a color each. */
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const i of plan?.items ?? []) for (const n of i.notes) if (!seen.includes(n.category)) seen.push(n.category);
    return seen.map((c, i) => ({ name: c, color: PALETTE[i % PALETTE.length] }));
  }, [plan]);
  const colorOf = (c: string) => categories.find((x) => x.name === c)?.color ?? "#94A3B8";
  const team = layout !== "all" && categories.some((c) => c.name === layout) ? layout : null;

  /** Clock time for each item, counted from the chosen service time (pre-service items count back). */
  const starts = useMemo(() => {
    const m = new Map<string, number>();
    if (!plan || !time) return m;
    const pre = plan.items.filter((i) => i.servicePosition === "pre").reduce((n, i) => n + i.lengthSec, 0);
    let t = Date.parse(time.startsAt) - pre * 1000;
    for (const i of plan.items) { m.set(i.id, t); t += i.lengthSec * 1000; }
    return m;
  }, [plan, time]);

  const l = live.data ?? null;
  const items = plan?.items ?? [];
  const curIdx = l?.currentItemId ? items.findIndex((i) => i.id === l.currentItemId) : -1;

  // Follow Live: keep the current item in view.
  const rowRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!follow || !l?.currentItemId) return;
    rowRefs.current.get(l.currentItemId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [follow, l?.currentItemId]);

  const toggleFull = useCallback(() => {
    setKiosk((k) => {
      const next = !k;
      if (next) document.documentElement.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) void document.exitFullscreen();
      return next;
    });
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "SELECT" || e.metaKey || e.ctrlKey) return;
      if (e.key === "f" || e.key === "F") toggleFull();
      else if (e.key === "+" || e.key === "=") setSize((s) => Math.min(26, s + 1));
      else if (e.key === "-" || e.key === "_") setSize((s) => Math.max(11, s - 1));
      else if (e.key === "l" || e.key === "L") setFollow((f) => !f);
      else if (e.key === "p" || e.key === "P") window.print();
      else if (e.key === "Escape") setKiosk(false);
    };
    window.addEventListener("keydown", h);
    const fs = () => { if (!document.fullscreenElement) setKiosk(false); };
    document.addEventListener("fullscreenchange", fs);
    return () => { window.removeEventListener("keydown", h); document.removeEventListener("fullscreenchange", fs); };
  }, [toggleFull]);

  if (!plan) {
    return <div className="min-h-screen bg-canvas p-8">{data.error ? <p className="text-bad">Couldn’t load this run sheet: {(data.error as Error).message}</p> : <Skeleton className="h-96" />}</div>;
  }

  const startAt = time ? Date.parse(time.startsAt) : null;
  const toStart = startAt ? Math.round((startAt - now) / 1000) : null;
  const version = data.data!.planNotes.find((n) => /version/i.test(n.category));
  const otherNotes = data.data!.planNotes.filter((n) => n !== version);
  const noteCols = team ? [team] : categories.map((c) => c.name);
  const d = new Date(plan.sortDate);

  return (
    <div className="runsheet min-h-screen bg-canvas text-ink" style={{ fontSize: size }}>
      {/* ── Top bar ── */}
      {!kiosk && (
        <header className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 text-sm">
            <Link href={routes.plan(serviceTypeId, planId)} className="btn-ghost p-1.5" title="Back to the service"><ChevronLeft size={16} /></Link>
            <div className="min-w-0">
              <div className="text-[11px] text-ink-muted">{plan.serviceTypeName} · {d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
              <div className="truncate text-base font-semibold">{plan.title}</div>
            </div>
            {serviceTimes.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-ink-muted">Times for
                <select className="input w-auto py-1 text-xs" value={time?.id} onChange={(e) => setTimeId(e.target.value)}>
                  {serviceTimes.map((t) => <option key={t.id} value={t.id}>{clock(t.startsAt)}</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">Layout
              <select className="input w-auto py-1 text-xs" value={team ?? "all"} onChange={(e) => setLayout(e.target.value)}>
                <option value="all">Everyone (all notes)</option>
                {categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </label>
            <div className="flex items-center rounded-lg border border-line">
              <button className="px-2 py-1 text-ink-muted hover:text-ink" onClick={() => setSize((s) => Math.max(11, s - 1))} title="Smaller text (−)"><Minus size={13} /></button>
              <span className="w-8 text-center text-[11px] tabular-nums text-ink-muted">{size}</span>
              <button className="px-2 py-1 text-ink-muted hover:text-ink" onClick={() => setSize((s) => Math.min(26, s + 1))} title="Bigger text (+)"><Plus size={13} /></button>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted" title="Keep the current Live item in view (L)">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow Live
            </label>
            <div className="ml-auto flex items-center gap-3">
              <LiveBadge live={l} now={now} item={curIdx >= 0 ? items[curIdx] : null} />
              <div className="text-right leading-tight">
                <div className="font-mono text-lg font-semibold tabular-nums">{new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</div>
                {toStart !== null && toStart > 0 && toStart < 6 * 3600 && <div className="text-[11px] text-ink-muted">Starts in {hms(toStart)}</div>}
              </div>
              <button className="btn-ghost p-1.5" onClick={() => window.print()} title="Print (P)"><Printer size={16} /></button>
              <button className="btn-ghost p-1.5" onClick={toggleFull} title="Full screen (F)"><Maximize2 size={16} /></button>
            </div>
          </div>
        </header>
      )}
      {kiosk && (
        <button className="no-print fixed right-3 top-3 z-40 rounded-lg bg-surface/80 p-2 text-ink-muted opacity-40 transition hover:opacity-100" onClick={toggleFull} title="Leave full screen (Esc)">
          <Minimize2 size={16} />
        </button>
      )}

      {/* ── Plan notes ── */}
      <div className="px-5 pt-4">
        <div className="print-only mb-2">
          <div className="text-xl font-semibold">{plan.title}</div>
          <div className="text-sm">{plan.serviceTypeName} · {d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}{time ? ` · times for ${clock(time.startsAt)}` : ""}</div>
        </div>
        {(version || otherNotes.length > 0) && (
          <div className="mb-4 flex flex-wrap items-start gap-3">
            {version && <div className="rounded-xl border border-accent/40 bg-accent-soft px-4 py-2 font-semibold text-accent"><span className="mr-2 text-[0.75em] uppercase tracking-wider opacity-80">Version</span>{version.body}</div>}
            {otherNotes.map((n, i) => (
              <div key={i} className="max-w-3xl whitespace-pre-wrap rounded-xl border border-line bg-surface px-4 py-2 text-[0.9em] text-ink-soft">
                <span className="mr-2 text-[0.8em] font-semibold uppercase tracking-wider text-ink-muted">{n.category}</span>{n.body}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── The sheet ── */}
      <div className="px-5 pb-16">
        <table className="w-full border-separate border-spacing-0">
          <thead className="no-print-sticky">
            <tr className="text-left text-[0.72em] font-semibold uppercase tracking-wider text-ink-muted">
              <th className="sticky top-[var(--rs-top)] z-20 w-[6.5em] whitespace-nowrap border-b border-line bg-canvas py-2 pr-3 text-right">Time</th>
              <th className="sticky top-[var(--rs-top)] z-20 w-[4em] border-b border-line bg-canvas py-2 pr-3 text-right">Length</th>
              <th className="sticky top-[var(--rs-top)] z-20 min-w-[16em] border-b border-line bg-canvas py-2 pr-4">Item</th>
              {noteCols.map((c) => (
                <th key={c} className={clsx("sticky top-[var(--rs-top)] z-20 border-b border-line bg-canvas px-3 py-2", team ? "min-w-[22em]" : "min-w-[12em]")}>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: colorOf(c) }} />{c}</span>
                </th>
              ))}
              {team && categories.length > 1 && <th className="sticky top-[var(--rs-top)] z-20 min-w-[12em] border-b border-line bg-canvas px-3 py-2">Other notes</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              if (item.kind === "header") {
                return (
                  <tr key={item.id}>
                    <td colSpan={3 + noteCols.length + (team && categories.length > 1 ? 1 : 0)}
                      className="border-b border-line bg-surface px-3 py-1.5 text-[0.75em] font-bold uppercase tracking-[0.14em] text-ink-muted">{item.title}</td>
                  </tr>
                );
              }
              const isLive = l?.currentItemId === item.id;
              const isNext = l?.nextItemId === item.id;
              const done = curIdx >= 0 && idx < curIdx;
              const mine = team ? item.notes.some((n) => n.category === team) : false;
              const Icon = item.kind === "song" ? Music2 : item.kind === "media" ? Film : Type;
              const start = starts.get(item.id);
              return (
                <tr key={item.id} ref={(el) => { if (el) rowRefs.current.set(item.id, el); }}
                  className={clsx("align-top transition-colors", done && "opacity-45", item.servicePosition !== "during" && !isLive && "opacity-70",
                    isLive ? "bg-accent-soft" : mine ? "bg-[var(--mine)]" : "")}
                  style={mine ? ({ "--mine": `${colorOf(team!)}14` } as React.CSSProperties) : undefined}>
                  <td className={clsx("relative whitespace-nowrap border-b border-line/70 py-2.5 pr-3 text-right font-mono text-[0.85em] tabular-nums text-ink-muted")}>
                    {(isLive || mine) && <span className="absolute inset-y-0 left-0 w-1 rounded-r" style={{ background: isLive ? "rgb(var(--c-accent))" : colorOf(team!) }} />}
                    {start ? clock(new Date(start).toISOString()) : ""}
                  </td>
                  <td className="border-b border-line/70 py-2.5 pr-3 text-right font-mono text-[0.85em] tabular-nums text-ink-muted">{item.lengthSec ? mmss(item.lengthSec) : ""}</td>
                  <td className="border-b border-line/70 py-2.5 pr-4">
                    <div className="flex items-start gap-2">
                      <Icon size="1em" className={clsx("mt-[0.25em] shrink-0", item.kind === "song" ? "text-violet" : "text-ink-faint")} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{item.title}</span>
                          {item.songKey && <span className="rounded bg-violet-soft px-1.5 font-mono text-[0.75em] font-semibold text-violet">{item.songKey}</span>}
                          {isLive && <span className="rounded bg-accent px-1.5 py-0.5 text-[0.65em] font-bold uppercase tracking-wider text-white">Live</span>}
                          {isNext && <span className="rounded border border-accent/50 px-1.5 py-0.5 text-[0.65em] font-bold uppercase tracking-wider text-accent">Next</span>}
                        </div>
                        {isLive && l?.currentStartedAt && <Elapsed since={l.currentStartedAt} length={item.lengthSec} now={now} />}
                        {item.description && <div className="mt-0.5 whitespace-pre-wrap break-words text-[0.88em] leading-relaxed text-ink-muted">{item.description}</div>}
                      </div>
                    </div>
                  </td>
                  {noteCols.map((c) => <NoteCell key={c} item={item} category={c} color={colorOf(c)} strong={Boolean(team)} />)}
                  {team && categories.length > 1 && (
                    <td className="border-b border-line/70 px-3 py-2.5 text-[0.8em] text-ink-muted">
                      {item.notes.filter((n) => n.category !== team).map((n, i) => (
                        <div key={i} className="whitespace-pre-wrap break-words"><span className="font-semibold" style={{ color: colorOf(n.category) }}>{n.category}:</span> {n.body}</div>
                      ))}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="no-print mt-4 text-[11px] text-ink-faint">
          Updates every 10 seconds{l ? " · following Planning Center Live" : ""}. Keys: F full screen · + / − text size · L follow Live · P print.
        </p>
      </div>
      <style>{`.runsheet{--rs-top:${kiosk ? "0px" : "57px"}}`}</style>
    </div>
  );
}

function NoteCell({ item, category, color, strong }: { item: PlanItem; category: string; color: string; strong: boolean }) {
  const notes = item.notes.filter((n) => n.category === category);
  return (
    <td className="border-b border-line/70 px-3 py-2.5">
      {notes.map((n, i) => (
        <div key={i} className={clsx("whitespace-pre-wrap break-words rounded-md border-l-[3px] px-2 py-1 leading-relaxed", strong ? "text-[1em] text-ink" : "text-[0.85em] text-ink-soft")}
          style={{ borderColor: color, background: `${color}14` }}>
          {n.body}
        </div>
      ))}
    </td>
  );
}

function Elapsed({ since, length, now }: { since: string; length: number; now: number }) {
  const el = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  const over = length > 0 && el > length;
  return (
    <div className={clsx("mt-0.5 font-mono text-[0.85em] tabular-nums", over ? "text-bad" : "text-accent")}>
      {mmss(el)}{length ? ` / ${mmss(length)}` : ""}{over ? ` · ${mmss(el - length)} over` : length ? ` · ${mmss(length - el)} left` : ""}
    </div>
  );
}

function LiveBadge({ live, item, now }: { live: { controller: string | null; currentStartedAt: string | null } | null; item: PlanItem | null; now: number }) {
  if (!live || !item) return <span className="flex items-center gap-1.5 text-[11px] text-ink-faint"><Radio size={12} /> Live not started</span>;
  const el = live.currentStartedAt ? Math.max(0, Math.round((now - Date.parse(live.currentStartedAt)) / 1000)) : null;
  return (
    <span className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs text-accent" title={live.controller ? `Controlled by ${live.controller}` : undefined}>
      <span className="relative flex h-2 w-2"><span className="absolute h-full w-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative h-2 w-2 rounded-full bg-accent" /></span>
      <span className="max-w-[14em] truncate font-medium">{item.title}</span>
      {el !== null && <span className="font-mono tabular-nums">{mmss(el)}</span>}
    </span>
  );
}

const hms = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
