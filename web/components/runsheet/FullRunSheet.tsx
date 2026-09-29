"use client";
/**
 * The whole-page run sheet (in the spirit of ScriptViewer), connected to Planning Center:
 *  - Views: each operator picks which Planning Center note categories show (Lighting, Audio…), in
 *    their order, with one highlighted, and which plan notes show at the top.
 *  - Edit: press Edit and everything on the sheet becomes editable in place (titles, lengths,
 *    descriptions and the note columns). Each change saves to Planning Center when you leave the
 *    field. Add headers, items, media and songs, move and delete items. Songs' arrangement and key
 *    still open the item window (the pencil).
 *  - Live: follows Planning Center Live, and drives it (Previous / Next / Take control).
 *  - Compare: actual times against another service time (the 9:00 while you run the 11:00) or
 *    another campus's service, with how far over/under you are right now.
 *  - Watch: other services' Live positions in a side panel.
 *
 * Keys: F full screen · + / − text size · L follow Live · P print · E edit · Esc leave full screen.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Film, GitCompareArrows, Hand, Maximize2, Minimize2, Minus, Music2, Pencil, Plus,
  Printer, Radio, SlidersHorizontal, Trash2, Type,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { PlanDetail, PlanItem, RunSheetData, RunSheetView } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { clock, mmss } from "@/lib/format";
import { usePlans } from "@/lib/plans";
import { routes } from "@/lib/routes";
import { actuals, delta, matchItems, mmssAny } from "@/lib/runsheet";
import { Skeleton } from "@/components/ui";
import { ItemModal } from "./ItemModal";
import { ViewEditor } from "./ViewEditor";
import { WatchPanel } from "./WatchPanel";

const PALETTE = ["#60A5FA", "#34D399", "#F59E0B", "#F472B6", "#A78BFA", "#22D3EE", "#FB7185", "#A3E635", "#FBBF24", "#818CF8"];
const LS = "coolservices.runsheet";
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(`${LS}.${k}`); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const keep = (k: string, v: unknown) => { try { localStorage.setItem(`${LS}.${k}`, JSON.stringify(v)); } catch { /* ignore */ } };

export function FullRunSheet({ serviceTypeId, planId, kioskStart }: { serviceTypeId: string; planId: string; kioskStart?: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  // While editing, don't pull a fresh copy under someone's cursor; it refreshes after each save.
  const data = useQuery({ queryKey: qk.runSheet(planId), queryFn: () => Api.runSheet(serviceTypeId, planId), refetchInterval: editing ? false : 10_000, refetchIntervalInBackground: true });
  const live = useQuery({ queryKey: qk.live(planId), queryFn: () => Api.live(serviceTypeId, planId), refetchInterval: 3_000, refetchIntervalInBackground: true, retry: false });
  const times = useQuery({ queryKey: qk.itemTimes(planId), queryFn: () => Api.itemTimes(serviceTypeId, planId), refetchInterval: 10_000, retry: false });
  const views = useQuery({ queryKey: qk.runSheetViews, queryFn: Api.runSheetViews });
  const cats = useQuery({ queryKey: qk.noteCategories(serviceTypeId), queryFn: () => Api.noteCategories(serviceTypeId), staleTime: 10 * 60_000, retry: false });
  const plans = usePlans();

  const [viewId, setViewId] = useState<string>(() => load("view", "all"));
  const [size, setSize] = useState<number>(() => load("size", 15));
  const [follow, setFollow] = useState<boolean>(() => load("follow", true));
  const [compareKey, setCompareKey] = useState<string>("");
  const [watching, setWatching] = useState<string[]>(() => load("watching", []));
  const [watchOpen, setWatchOpen] = useState<boolean>(() => load("watchOpen", false));
  const [saving, setSaving] = useState(0);
  const [modal, setModal] = useState<{ item?: PlanItem; after?: string | null } | null>(null);
  const [viewEditor, setViewEditor] = useState<RunSheetView | "new" | null>(null);
  const [timeId, setTimeId] = useState<string | null>(null);
  const [kiosk, setKiosk] = useState(Boolean(kioskStart));
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => keep("view", viewId), [viewId]);
  useEffect(() => keep("size", size), [size]);
  useEffect(() => keep("follow", follow), [follow]);
  useEffect(() => keep("watching", watching), [watching]);
  useEffect(() => keep("watchOpen", watchOpen), [watchOpen]);

  const plan = data.data?.plan;
  const items = plan?.items ?? [];
  const serviceTimes = (plan?.times ?? []).filter((t) => t.kind === "service");
  const l = live.data ?? null;

  // Which service time we're on: chosen, else the one Live is running, else the next one.
  const runningTimeId = useMemo(() => {
    if (!plan || !l?.currentItemId) return null;
    const t = times.data?.[l.currentItemId];
    return serviceTimes.find((s) => t?.[s.id]?.start && !t?.[s.id]?.end)?.id ?? null;
  }, [plan, l?.currentItemId, times.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const time = serviceTimes.find((t) => t.id === timeId) ?? serviceTimes.find((t) => t.id === runningTimeId)
    ?? serviceTimes.find((t) => Date.parse(t.endsAt || t.startsAt) > now) ?? serviceTimes[0];

  /** Note categories: Planning Center's list for this service type, plus any used in the plan. */
  const categories = useMemo(() => {
    const seen: string[] = (cats.data ?? []).map((c) => c.name);
    for (const i of items) for (const n of i.notes) if (!seen.includes(n.category)) seen.push(n.category);
    return seen;
  }, [cats.data, items]);
  const colorOf = useCallback((c: string) => PALETTE[Math.max(0, categories.indexOf(c)) % PALETTE.length], [categories]);
  const view = views.data?.find((v) => v.id === viewId) ?? null;
  const used = new Set(items.flatMap((i) => i.notes.map((n) => n.category)));
  // Editing with "Everyone": every category, so a note can go in one this plan hasn't used yet.
  const noteCols = view ? view.categories : categories.filter((c) => editing || used.has(c));
  const highlight = view?.highlight ?? null;
  const showDesc = view ? view.showDescriptions : true;

  /** Planned clock time for each item, counted from the chosen service time (pre-service counts back). */
  const starts = useMemo(() => {
    const m = new Map<string, number>();
    if (!plan || !time) return m;
    const pre = items.filter((i) => i.servicePosition === "pre").reduce((n, i) => n + i.lengthSec, 0);
    let t = Date.parse(time.startsAt) - pre * 1000;
    for (const i of items) { m.set(i.id, t); t += i.lengthSec * 1000; }
    return m;
  }, [plan, time, items]);
  const ours = useMemo(() => (plan && time ? actuals(plan, times.data, time.id) : new Map()), [plan, time, times.data]);
  const hasActuals = ours.size > 0;

  /* ── Compare ── */
  const sameDay = useMemo(() => {
    if (!plan) return [];
    const day = new Date(plan.sortDate).toDateString();
    return (plans.data ?? []).filter((p) => p.id !== plan.id && new Date(p.sortDate).toDateString() === day);
  }, [plans.data, plan]);
  const [cmpPlanId, cmpTimeId] = compareKey.split(":");
  const cmpOther = cmpPlanId && cmpPlanId !== planId ? sameDay.find((p) => p.id === cmpPlanId) ?? (plans.data ?? []).find((p) => p.id === cmpPlanId) : undefined;
  const cmpData = useQuery({ queryKey: qk.runSheet(cmpPlanId ?? ""), queryFn: () => Api.runSheet(cmpOther!.serviceTypeId, cmpPlanId), enabled: Boolean(cmpOther), refetchInterval: 30_000 });
  const cmpTimes = useQuery({
    queryKey: qk.itemTimes(cmpPlanId ?? ""), queryFn: () => Api.itemTimes(cmpOther?.serviceTypeId ?? serviceTypeId, cmpPlanId),
    enabled: Boolean(compareKey), refetchInterval: 15_000, retry: false,
  });
  // Picking another campus's service: once its plan loads, compare with its first service time.
  useEffect(() => {
    if (cmpOther && !cmpTimeId && cmpData.data) {
      const t = cmpData.data.plan.times.find((x) => x.kind === "service");
      if (t) setCompareKey(`${cmpOther.id}:${t.id}`);
    }
  }, [cmpOther, cmpTimeId, cmpData.data]);
  const cmpPlan: PlanDetail | undefined = !compareKey ? undefined : cmpOther ? cmpData.data?.plan : plan;
  const theirs = useMemo(() => (cmpPlan ? actuals(cmpPlan, cmpTimes.data, cmpTimeId) : new Map()), [cmpPlan, cmpTimes.data, cmpTimeId]);
  const match = useMemo(() => (cmpPlan ? matchItems(items, cmpPlan.items, cmpPlan.id === planId) : new Map<string, string>()), [cmpPlan, items, planId]);
  const cmpLabel = !compareKey ? "" : `${cmpOther ? `${cmpOther.serviceTypeName} ` : ""}${clock(cmpPlan?.times.find((t) => t.id === cmpTimeId)?.startsAt ?? new Date().toISOString())}`;

  const curIdx = l?.currentItemId ? items.findIndex((i) => i.id === l.currentItemId) : -1;
  // Right now vs the compared service: when our current item started vs when theirs did.
  const curDrift = useMemo(() => {
    if (!compareKey || curIdx < 0 || !time) return null;
    const cur = items[curIdx];
    const oursStart = ours.get(cur.id)?.startOff ?? (l?.currentStartedAt ? (Date.parse(l.currentStartedAt) - Date.parse(time.startsAt)) / 1000 : null);
    const theirsStart = theirs.get(match.get(cur.id) ?? "")?.startOff;
    return oursStart != null && theirsStart != null ? oursStart - theirsStart : null;
  }, [compareKey, curIdx, items, ours, theirs, match, l?.currentStartedAt, time]);

  // The top bar can wrap onto two lines; the table's sticky header sits right under it.
  const barRef = useRef<HTMLElement>(null);
  const [barH, setBarH] = useState(57);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarH(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Follow Live: keep the current item in view.
  const rowRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!follow || !l?.currentItemId || editing) return;
    rowRefs.current.get(l.currentItemId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [follow, l?.currentItemId, editing]);

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
      if ((e.target as HTMLElement)?.closest("input, textarea, select") || e.metaKey || e.ctrlKey || modal || viewEditor) return;
      if (e.key === "f" || e.key === "F") toggleFull();
      else if (e.key === "+" || e.key === "=") setSize((s) => Math.min(26, s + 1));
      else if (e.key === "-" || e.key === "_") setSize((s) => Math.max(11, s - 1));
      else if (e.key === "l" || e.key === "L") setFollow((f) => !f);
      else if (e.key === "e" || e.key === "E") setEditing((x) => !x);
      else if (e.key === "p" || e.key === "P") window.print();
      else if (e.key === "Escape") setKiosk(false);
    };
    window.addEventListener("keydown", h);
    const fs = () => { if (!document.fullscreenElement) setKiosk(false); };
    document.addEventListener("fullscreenchange", fs);
    return () => { window.removeEventListener("keydown", h); document.removeEventListener("fullscreenchange", fs); };
  }, [toggleFull, modal, viewEditor]);

  /** After an edit, Planning Center sends back the new run sheet. */
  const applyItems = (next: PlanItem[]) => {
    qc.setQueryData<RunSheetData>(qk.runSheet(planId), (d) => d && { ...d, plan: { ...d.plan, items: next } });
    void qc.invalidateQueries({ queryKey: qk.plan(serviceTypeId, planId) });
  };
  const run = async (label: string, fn: () => Promise<PlanItem[]>) => {
    try { applyItems(await fn()); } catch (e) { toast.error(`Couldn’t ${label}`, { description: (e as Error).message }); }
  };
  /** Inline edits: one field at a time, straight to Planning Center. */
  const saveField = async (label: string, fn: () => Promise<PlanItem[]>) => {
    setSaving((n) => n + 1);
    try { applyItems(await fn()); return true; }
    catch (e) { toast.error(`Couldn’t save the ${label}`, { description: (e as Error).message }); return false; }
    finally { setSaving((n) => n - 1); }
  };
  const saveItem = (item: PlanItem, input: { title?: string; lengthSec?: number; description?: string | null }, label: string) =>
    saveField(label, () => Api.editItem(serviceTypeId, planId, item.id, input));
  const catId = (name: string) => cats.data?.find((c) => c.name === name)?.id ?? null;
  const saveNote = (item: PlanItem, category: string, text: string) => {
    const existing = item.notes.find((n) => n.category === category);
    const cid = existing?.categoryId ?? catId(category);
    if (!cid) { toast.error(`“${category}” isn’t a note category on this service type in Planning Center`); return Promise.resolve(false); }
    const t = text.trim();
    if (existing?.id && !t) return saveField(`${category} note`, () => Api.deleteNote(serviceTypeId, planId, item.id, existing.id!));
    if (!t && !existing) return Promise.resolve(true);
    return saveField(`${category} note`, () => Api.saveNote(serviceTypeId, planId, item.id, { noteId: existing?.id, categoryId: cid, content: t }));
  };
  const moveItem = (idx: number, d: -1 | 1) => {
    const ids = items.map((i) => i.id);
    const j = idx + d;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    const byId = new Map(items.map((i) => [i.id, i]));
    applyItems(ids.map((id) => byId.get(id)!)); // show it moved right away
    void run("move it", () => Api.reorderItems(serviceTypeId, planId, ids));
  };
  const liveDo = async (action: "next" | "previous" | "take_control") => {
    try { qc.setQueryData(qk.live(planId), await Api.liveControl(serviceTypeId, planId, action)); void times.refetch(); }
    catch (e) { toast.error("Planning Center Live didn’t respond", { description: (e as Error).message }); }
  };

  if (!plan) {
    return <div className="min-h-screen bg-canvas p-8">{data.error ? <p className="text-bad">Couldn’t load this run sheet: {(data.error as Error).message}</p> : <Skeleton className="h-96" />}</div>;
  }

  const startAt = time ? Date.parse(time.startsAt) : null;
  const toStart = startAt ? Math.round((startAt - now) / 1000) : null;
  const allPlanNotes = data.data!.planNotes.filter((n) => !view?.planNotes || view.planNotes.includes(n.category));
  const version = allPlanNotes.find((n) => /version/i.test(n.category));
  const otherNotes = allPlanNotes.filter((n) => n !== version);
  const d = new Date(plan.sortDate);
  const extraCols = (hasActuals ? 1 : 0) + (compareKey ? 1 : 0) + (editing ? 1 : 0);
  const colSpan = 3 + noteCols.length + extraCols;
  const compareOptions = [
    ...serviceTimes.filter((t) => t.id !== time?.id).map((t) => ({ key: `${planId}:${t.id}`, label: `${clock(t.startsAt)} (this service)` })),
    ...sameDay.flatMap((p) => {
      const known = p.id === cmpPlanId ? cmpData.data?.plan.times.filter((t) => t.kind === "service") : undefined;
      return known?.length ? known.map((t) => ({ key: `${p.id}:${t.id}`, label: `${p.serviceTypeName} · ${clock(t.startsAt)}` }))
        : [{ key: `${p.id}:`, label: `${p.serviceTypeName} · ${p.title}` }];
    }),
  ];

  return (
    <div className="runsheet min-h-screen bg-canvas text-ink" style={{ fontSize: size, paddingRight: watchOpen && !kiosk ? 340 : 0 }}>
      {/* ── Top bar ── */}
      {!kiosk && (
        <header ref={barRef} className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5 text-sm">
            <Link href={routes.plan(serviceTypeId, planId)} className="btn-ghost p-1.5" title="Back to the service"><ChevronLeft size={16} /></Link>
            <div className="min-w-0">
              <div className="text-[11px] text-ink-muted">{plan.serviceTypeName} · {d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
              <div className="truncate text-base font-semibold">{plan.title}</div>
            </div>
            {serviceTimes.length > 0 && (
              <select className="input w-auto py-1 text-xs" value={time?.id} onChange={(e) => setTimeId(e.target.value)} title="Service time for the clock">
                {serviceTimes.map((t) => <option key={t.id} value={t.id}>{clock(t.startsAt)}{t.id === runningTimeId ? " · Live" : ""}</option>)}
              </select>
            )}
            <div className="flex items-center gap-1">
              <select className="input w-auto max-w-[13rem] py-1 text-xs" value={view?.id ?? "all"} onChange={(e) => e.target.value === "__new" ? setViewEditor("new") : setViewId(e.target.value)} title="Operator view">
                <option value="all">Everyone (all notes)</option>
                {views.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                <option value="__new">+ New view…</option>
              </select>
              {view && <button className="btn-ghost p-1" title="Edit this view" onClick={() => setViewEditor(view)}><SlidersHorizontal size={13} /></button>}
            </div>
            <select className={clsx("input w-auto max-w-[15rem] py-1 text-xs", compareKey && "border-accent/60 text-accent")} value={compareKey} onChange={(e) => setCompareKey(e.target.value)} title="Compare actual times">
              <option value="">Compare with…</option>
              {compareOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <div className="flex items-center rounded-lg border border-line">
              <button className="px-2 py-1 text-ink-muted hover:text-ink" onClick={() => setSize((s) => Math.max(11, s - 1))} title="Smaller text (−)"><Minus size={13} /></button>
              <span className="w-7 text-center text-[11px] tabular-nums text-ink-muted">{size}</span>
              <button className="px-2 py-1 text-ink-muted hover:text-ink" onClick={() => setSize((s) => Math.min(26, s + 1))} title="Bigger text (+)"><Plus size={13} /></button>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted" title="Keep the current Live item in view (L)">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
            </label>
            <button className={clsx("btn-ghost py-1 text-xs", editing && "bg-accent-soft text-accent")} onClick={() => setEditing(!editing)} title="Edit the run sheet in Planning Center (E)"><Pencil size={13} /> {editing ? "Done" : "Edit"}</button>
            {editing && <span className="text-[11px] text-ink-muted">{saving ? "Saving to Planning Center…" : "Click anything to change it · saves when you leave the field"}</span>}
            <button className={clsx("btn-ghost py-1 text-xs", watchOpen && "bg-accent-soft text-accent")} onClick={() => setWatchOpen(!watchOpen)}><Radio size={13} /> Watch</button>

            <div className="ml-auto flex items-center gap-2">
              <LiveControls live={l} onDo={liveDo} />
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

      {/* ── Plan notes + compare summary ── */}
      <div className="px-5 pt-4">
        <div className="print-only mb-2">
          <div className="text-xl font-semibold">{plan.title}</div>
          <div className="text-sm">{plan.serviceTypeName} · {d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}{time ? ` · times for ${clock(time.startsAt)}` : ""}{view ? ` · ${view.name}` : ""}</div>
        </div>
        {compareKey && (
          <div className="no-print mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2 text-[0.9em]">
            <GitCompareArrows size={16} className="text-accent" />
            <span className="text-ink-muted">Comparing {time ? clock(time.startsAt) : "this service"} with <b className="text-ink">{cmpLabel}</b></span>
            {curDrift != null ? (
              <span className={clsx("rounded-lg px-2.5 py-0.5 font-mono font-semibold tabular-nums", curDrift > 30 ? "bg-bad-soft text-bad" : curDrift < -30 ? "bg-ok-soft text-ok" : "bg-hover text-ink-soft")}>
                {delta(curDrift)} {curDrift >= 0 ? "later" : "earlier"} at this item
              </span>
            ) : <span className="text-ink-faint">{theirs.size ? "Start Live to see how far over or under you are." : "No actual times for that service yet."}</span>}
            <button className="btn-ghost ml-auto py-0.5 text-xs" onClick={() => setCompareKey("")}>Stop comparing</button>
          </div>
        )}
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
          <thead>
            <tr className="text-left text-[0.72em] font-semibold uppercase tracking-wider text-ink-muted">
              {editing && <th className="sticky top-[var(--rs-top)] z-20 w-[6.5em] border-b border-line bg-canvas py-2" />}
              <th className="sticky top-[var(--rs-top)] z-20 w-[7em] whitespace-nowrap border-b border-line bg-canvas py-2 pl-3 pr-3 text-right">Time</th>
              <th className="sticky top-[var(--rs-top)] z-20 w-[4em] border-b border-line bg-canvas py-2 pr-3 text-right">Length</th>
              {hasActuals && <th className="sticky top-[var(--rs-top)] z-20 w-[4.5em] border-b border-line bg-canvas py-2 pr-3 text-right" title="How long it actually ran">Actual</th>}
              {compareKey && <th className="sticky top-[var(--rs-top)] z-20 w-[6em] whitespace-nowrap border-b border-line bg-canvas py-2 pr-3 text-right" title={`Actual length vs ${cmpLabel}`}>vs {cmpLabel.split(" ").slice(-2).join(" ")}</th>}
              <th className="sticky top-[var(--rs-top)] z-20 min-w-[16em] border-b border-line bg-canvas py-2 pr-4">Item</th>
              {noteCols.map((c) => (
                <th key={c} className={clsx("sticky top-[var(--rs-top)] z-20 min-w-[12em] border-b border-line bg-canvas px-3 py-2", highlight === c && "text-ink")}>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: colorOf(c) }} />{c}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {editing && (
              <tr className="no-print"><td colSpan={colSpan} className="py-1"><AddRow onAdd={() => setModal({ after: null })} label="Add at the top" /></td></tr>
            )}
            {items.map((item, idx) => {
              const isLive = l?.currentItemId === item.id;
              const isNext = l?.nextItemId === item.id;
              const done = curIdx >= 0 && idx < curIdx;
              const mine = highlight ? item.notes.some((n) => n.category === highlight) : false;
              const edit = editing && (
                <td className="no-print whitespace-nowrap border-b border-line/70 py-1.5 pr-2 align-top">
                  <div className="flex items-center gap-0.5">
                    <button className="btn-ghost p-1" title="Move up" disabled={idx === 0} onClick={() => moveItem(idx, -1)}><ArrowUp size={12} /></button>
                    <button className="btn-ghost p-1" title="Move down" disabled={idx === items.length - 1} onClick={() => moveItem(idx, 1)}><ArrowDown size={12} /></button>
                    <button className="btn-ghost p-1" title={item.kind === "song" ? "Arrangement, key and more" : "Open in a window"} onClick={() => setModal({ item })}><Pencil size={12} /></button>
                    <button className="btn-ghost p-1 hover:text-bad" title="Delete" onClick={() => { if (confirm(`Delete “${item.title}” from the plan in Planning Center?`)) void run("delete it", () => Api.deleteItem(serviceTypeId, planId, item.id)); }}><Trash2 size={12} /></button>
                  </div>
                </td>
              );
              const after = editing ? (
                <tr key={`${item.id}-add`} className="no-print"><td colSpan={colSpan} className="py-0.5"><AddRow onAdd={() => setModal({ after: item.id })} /></td></tr>
              ) : null;
              if (item.kind === "header") {
                return [
                  <tr key={item.id} ref={(el) => { if (el) rowRefs.current.set(item.id, el); }}>
                    {edit}
                    <td colSpan={colSpan - (editing ? 1 : 0)} className="border-b border-line bg-surface px-3 py-1.5 text-[0.75em] font-bold uppercase tracking-[0.14em] text-ink-muted">
                      {editing ? <Inline value={item.title} className="uppercase tracking-[0.14em]" onSave={(v) => v.trim() ? saveItem(item, { title: v.trim() }, "header") : Promise.resolve(false)} /> : item.title}
                    </td>
                  </tr>,
                  after,
                ];
              }
              const Icon = item.kind === "song" ? Music2 : item.kind === "media" ? Film : Type;
              const start = starts.get(item.id);
              const act = ours.get(item.id);
              const actDur = act?.dur ?? (act?.running && l?.currentStartedAt && isLive ? (now - Date.parse(l.currentStartedAt)) / 1000 : null);
              const their = theirs.get(match.get(item.id) ?? "");
              // Only finished items get a +/−; the one running now shows the other service's length to aim for.
              const cmpDelta = act?.dur != null && their?.dur != null ? act.dur - their.dur : null;
              return [
                <tr key={item.id} ref={(el) => { if (el) rowRefs.current.set(item.id, el); }}
                  className={clsx("align-top transition-colors", done && !editing && "opacity-45", item.servicePosition !== "during" && !isLive && "opacity-70",
                    isLive ? "bg-accent-soft" : mine ? "bg-[var(--mine)]" : "")}
                  style={mine ? ({ "--mine": `${colorOf(highlight!)}14` } as React.CSSProperties) : undefined}>
                  {edit}
                  <td className="relative whitespace-nowrap border-b border-line/70 py-2.5 pl-3 pr-3 text-right font-mono text-[0.85em] tabular-nums text-ink-muted">
                    {(isLive || mine) && <span className="absolute inset-y-0 left-0 w-1 rounded-r" style={{ background: isLive ? "rgb(var(--c-accent))" : colorOf(highlight!) }} />}
                    {start ? clock(new Date(start).toISOString()) : ""}
                  </td>
                  <td className="border-b border-line/70 py-2.5 pr-3 text-right font-mono text-[0.85em] tabular-nums text-ink-muted">
                    {editing ? (
                      <Inline value={item.lengthSec ? mmss(item.lengthSec) : ""} placeholder="0:00" className="text-right" onSave={(v) => {
                        const sec = parseLength(v);
                        if (sec == null) { toast.error("Lengths look like 4:30 (or just minutes, like 5)"); return Promise.resolve(false); }
                        return sec === item.lengthSec ? Promise.resolve(true) : saveItem(item, { lengthSec: sec }, "length");
                      }} />
                    ) : item.lengthSec ? mmss(item.lengthSec) : ""}
                  </td>
                  {hasActuals && (
                    <td className={clsx("border-b border-line/70 py-2.5 pr-3 text-right font-mono text-[0.85em] tabular-nums",
                      actDur != null && item.lengthSec && actDur > item.lengthSec + 15 ? "text-bad" : "text-ink-soft")}>
                      {actDur != null ? mmssAny(actDur) : ""}
                    </td>
                  )}
                  {compareKey && (
                    <td className={clsx("border-b border-line/70 py-2.5 pr-3 text-right font-mono text-[0.85em] tabular-nums",
                      cmpDelta == null ? "text-ink-faint" : cmpDelta > 15 ? "text-bad" : cmpDelta < -15 ? "text-ok" : "text-ink-muted")}
                      title={their?.dur != null ? `${cmpLabel}: ${mmssAny(their.dur)}` : undefined}>
                      {cmpDelta != null ? delta(cmpDelta) : their?.dur != null ? mmssAny(their.dur) : ""}
                    </td>
                  )}
                  <td className="border-b border-line/70 py-2.5 pr-4">
                    <div className="flex items-start gap-2">
                      <Icon size="1em" className={clsx("mt-[0.25em] shrink-0", item.kind === "song" ? "text-violet" : "text-ink-faint")} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {editing
                            ? <Inline wrap value={item.title} className="font-semibold" onSave={(v) => v.trim() ? saveItem(item, { title: v.trim() }, "title") : Promise.resolve(false)} />
                            : <span className="font-semibold">{item.title}</span>}
                          {item.songKey && <span className="rounded bg-violet-soft px-1.5 font-mono text-[0.75em] font-semibold text-violet">{item.songKey}</span>}
                          {isLive && <span className="rounded bg-accent px-1.5 py-0.5 text-[0.65em] font-bold uppercase tracking-wider text-white">Live</span>}
                          {isNext && <span className="rounded border border-accent/50 px-1.5 py-0.5 text-[0.65em] font-bold uppercase tracking-wider text-accent">Next</span>}
                        </div>
                        {isLive && l?.currentStartedAt && <Elapsed since={l.currentStartedAt} length={item.lengthSec} now={now} />}
                        {editing ? (
                          <Inline multiline value={item.description ?? ""} placeholder="Description" className="mt-0.5 text-[0.88em] leading-relaxed text-ink-muted"
                            onSave={(v) => saveItem(item, { description: v.trim() || null }, "description")} />
                        ) : showDesc && item.description && <div className="mt-0.5 whitespace-pre-wrap break-words text-[0.88em] leading-relaxed text-ink-muted">{item.description}</div>}
                      </div>
                    </div>
                  </td>
                  {noteCols.map((c) => editing ? (
                    <td key={c} className="border-b border-line/70 px-3 py-2">
                      <Inline multiline value={item.notes.filter((n) => n.category === c).map((n) => n.body).join("\n\n")} placeholder={c}
                        className="rounded-md border-l-[3px] px-2 py-1 text-[0.85em] leading-relaxed" style={{ borderLeftColor: colorOf(c), background: `${colorOf(c)}14` }}
                        onSave={(v) => saveNote(item, c, v)} />
                    </td>
                  ) : <NoteCell key={c} item={item} category={c} color={colorOf(c)} strong={highlight === c} />)}
                </tr>,
                after,
              ];
            })}
          </tbody>
        </table>
        <p className="no-print mt-4 text-[11px] text-ink-faint">
          Updates every 10 seconds{l?.currentItemId ? " · following Planning Center Live" : ""}. Keys: F full screen · + / − text size · L follow Live · E edit · P print.
        </p>
      </div>
      <style>{`.runsheet{--rs-top:${kiosk ? 0 : Math.round(barH)}px}`}</style>

      {watchOpen && !kiosk && (
        <WatchPanel candidates={sameDay} watching={watching} setWatching={setWatching} now={now} onClose={() => setWatchOpen(false)} />
      )}
      {modal && (
        <ItemModal st={serviceTypeId} planId={planId} items={items} item={modal.item} afterItemId={modal.after}
          categories={cats.data ?? []} onClose={() => setModal(null)} onDone={(next) => { applyItems(next); setModal(null); }} />
      )}
      {viewEditor && (
        <ViewEditor view={viewEditor === "new" ? null : viewEditor} categories={categories}
          planNoteCategories={[...new Set(data.data!.planNotes.map((n) => n.category))]} colorOf={colorOf}
          onClose={() => setViewEditor(null)} onSaved={(v) => { setViewEditor(null); setViewId(v?.id ?? "all"); }} />
      )}
    </div>
  );
}

/** "4:30" → 270, "5" → 300 (minutes), "" → 0. */
function parseLength(v: string): number | null {
  const t = v.trim();
  if (!t) return 0;
  const m = t.match(/^(\d{1,3})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const sec = m[2] != null ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]) * 60;
  return m[2] != null && Number(m[2]) > 59 ? null : sec;
}

/**
 * A field on the sheet you can click into and type. Saves when you leave it (or press Enter on a
 * one-line field); Esc puts it back. Keeps what you typed if Planning Center refuses it.
 */
function Inline({ value, onSave, multiline, wrap, placeholder, className, style }: {
  value: string; onSave: (v: string) => Promise<boolean>; multiline?: boolean; /** one line of text that wraps (Enter saves) */ wrap?: boolean; placeholder?: string; className?: string; style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => { if (!focused && !busy) setDraft(value); }, [value, focused, busy]);
  useEffect(() => { // grow with the text
    const el = ref.current;
    if ((multiline || wrap) && el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [draft, multiline, wrap]);
  const commit = async () => {
    setFocused(false);
    if (draft === value) return;
    setBusy(true);
    const ok = await onSave(draft);
    setBusy(false);
    if (ok) return;
    ref.current?.focus();
  };
  const common = {
    ref, value: draft, placeholder, style,
    onFocus: () => setFocused(true), onBlur: () => void commit(),
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(wrap ? e.target.value.replace(/\n/g, " ") : e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { setDraft(value); setTimeout(() => ref.current?.blur()); }
      else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); ref.current?.blur(); }
    },
    className: clsx("w-full resize-none rounded border border-transparent bg-transparent px-1 -mx-1 outline-none transition placeholder:text-ink-faint/60 hover:border-line focus:border-accent/60 focus:bg-surface",
      busy && "opacity-60", className),
  };
  return multiline || wrap ? <textarea rows={1} {...common} /> : <input {...common} />;
}

function AddRow({ onAdd, label }: { onAdd: () => void; label?: string }) {
  return (
    <button onClick={onAdd} className="group flex w-full items-center gap-2 px-2 text-[11px] text-ink-faint hover:text-accent">
      <span className="h-px flex-1 bg-line group-hover:bg-accent/50" />
      <span className="flex items-center gap-1"><Plus size={11} /> {label ?? "Add here"}</span>
      <span className="h-px flex-1 bg-line group-hover:bg-accent/50" />
    </button>
  );
}

function LiveControls({ live, onDo }: { live: { youControl?: boolean; canTakeControl?: boolean; currentItemId: string | null } | null; onDo: (a: "next" | "previous" | "take_control") => void }) {
  if (!live) return null;
  if (live.youControl) {
    return (
      <div className="flex items-center rounded-lg border border-accent/40">
        <button className="px-2 py-1 text-accent hover:bg-accent-soft" title="Previous item in Planning Center Live" onClick={() => onDo("previous")}><ChevronLeft size={15} /></button>
        <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-accent">Live</span>
        <button className="px-2 py-1 text-accent hover:bg-accent-soft" title="Next item in Planning Center Live" onClick={() => onDo("next")}><ChevronRight size={15} /></button>
      </div>
    );
  }
  return live.canTakeControl ? (
    <button className="btn-outline py-1 text-xs" title="Drive Planning Center Live from here" onClick={() => onDo("take_control")}><Hand size={13} /> {live.currentItemId ? "Take control" : "Start Live"}</button>
  ) : null;
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
      <span className="max-w-[12em] truncate font-medium">{item.title}</span>
      {el !== null && <span className="font-mono tabular-nums">{mmss(el)}</span>}
    </span>
  );
}

const hms = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
