"use client";
/** Stage plot editor: palette → canvas → inspector. Saves automatically. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Copy, FileUp, ImageOff, LayoutGrid, Printer, RotateCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PlotItem, StagePlot } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { usePlans } from "@/lib/plans";
import { CARD_COLORS, COMMON_POSITIONS, DEFAULT_CARD, ITEM_TYPES, freeSpot, imageFileToDataUrl, itemInfo, newItem, pdfPageToImage, tidy } from "@/lib/stage";
import { Modal, Skeleton, Spinner } from "@/components/ui";
import { PlotCanvas } from "./PlotCanvas";

export function PlotEditor({ plotId }: { plotId: string }) {
  const qc = useQueryClient();
  const remote = useQuery({ queryKey: qk.plot(plotId), queryFn: () => Api.plot(plotId) });
  const plans = usePlans();
  const micSetup = useQuery({ queryKey: qk.micSetup, queryFn: Api.micSetup, staleTime: Infinity });
  const [plot, setPlot] = useState<StagePlot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "pending" | "saved">("idle");
  const [pdf, setPdf] = useState<{ file: File; pages: number; page: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (remote.data && !plot) setPlot(remote.data); }, [remote.data, plot]);

  // Leaving a brand-new plot without adding anything discards it, so blank "New stage plot"s
  // don't pile up in the list.
  const latest = useRef<StagePlot | null>(null);
  latest.current = plot;
  useEffect(() => () => {
    const p = latest.current;
    if (p && p.name === "New stage plot" && p.items.length === 0 && !p.background && !p.serviceTypeId) {
      void Api.deletePlot(p.id).then(() => qc.invalidateQueries({ queryKey: qk.plots })).catch(() => {});
    }
  }, [qc]);

  const save = useMutation({
    mutationFn: Api.savePlot,
    onSuccess: (p) => { qc.setQueryData(qk.plot(p.id), p); qc.invalidateQueries({ queryKey: qk.plots }); setSaving("saved"); },
    onError: (e) => { toast.error("Couldn’t save", { description: (e as Error).message }); setSaving("idle"); },
  });

  /** Update locally; save shortly after the last change. */
  const update = useCallback((next: StagePlot, now = false) => {
    setPlot(next);
    setSaving("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save.mutate(next), now ? 0 : 600);
  }, [save]);

  const item = plot?.items.find((i) => i.id === selected) ?? null;
  const setItem = useCallback((it: PlotItem, commit = true) => {
    if (!plot) return;
    const next = { ...plot, items: plot.items.map((x) => (x.id === it.id ? it : x)) };
    if (commit) update(next); else setPlot(next);
  }, [plot, update]);

  // Keyboard: delete, nudge, duplicate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!plot || !item || (e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "Backspace" || e.key === "Delete") { update({ ...plot, items: plot.items.filter((x) => x.id !== item.id) }); setSelected(null); e.preventDefault(); }
      const step = e.shiftKey ? 0.02 : 0.005;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) { setItem({ ...item, x: Math.min(1, Math.max(0, item.x + d[0])), y: Math.min(1, Math.max(0, item.y + d[1])) }); e.preventDefault(); }
      if (e.key === "d" && (e.metaKey || e.ctrlKey)) { duplicate(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!plot) return <div className="p-8"><Skeleton className="h-96" /></div>;

  const add = (type: PlotItem["type"]) => {
    const spot = freeSpot(plot.items);
    const it = newItem(type, spot.x, spot.y);
    update({ ...plot, items: [...plot.items, it] });
    setSelected(it.id);
  };
  function duplicate() {
    if (!plot || !item) return;
    const copy = { ...item, id: Math.random().toString(36).slice(2, 10), x: Math.min(1, item.x + 0.03), y: Math.min(1, item.y + 0.03) };
    update({ ...plot, items: [...plot.items, copy] });
    setSelected(copy.id);
  }

  async function applyBackground(dataUrl: string, width: number, height: number, source: string) {
    const { fileId } = await Api.uploadImage(dataUrl);
    update({ ...plot!, background: { fileId, width, height, source } }, true);
    toast.success("Background added");
  }
  async function pickFile(file: File) {
    setBusy(true);
    try {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const first = await pdfPageToImage(file, 1);
        if (first.pages > 1) { setPdf({ file, pages: first.pages, page: 1 }); return; }
        await applyBackground(first.dataUrl, first.width, first.height, file.name);
      } else if (/^image\/(png|jpeg|webp)$/.test(file.type)) {
        const img = await imageFileToDataUrl(file);
        await applyBackground(img.dataUrl, img.width, img.height, file.name);
      } else {
        toast.error("Use a PDF, PNG, JPG or WebP file");
      }
    } catch (e) {
      toast.error("Couldn’t read that file", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const serviceTypes = [...new Map((plans.data ?? []).map((p) => [p.serviceTypeId, p.serviceTypeName])).entries()];
  const groups = [...new Set(ITEM_TYPES.map((t) => t.group))];
  const positions = [...new Set([...COMMON_POSITIONS, ...(micSetup.data?.channels.flatMap((c) => c.positions) ?? [])])];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="no-print flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 pr-32">
        <Link href="/stage-plots" className="btn-ghost p-1.5"><ArrowLeft size={16} /></Link>
        <input className="input w-64 py-1.5 font-semibold" value={plot.name} onChange={(e) => update({ ...plot, name: e.target.value || "Untitled" })} />
        <select className="input w-56 py-1.5 text-xs" value={plot.serviceTypeId ?? ""} onChange={(e) => update({ ...plot, serviceTypeId: e.target.value || null }, true)}>
          <option value="">Not a default</option>
          {serviceTypes.map(([id, name]) => <option key={id} value={id}>Default for {name}</option>)}
        </select>
        <span className="text-[11px] text-ink-faint">{saving === "pending" ? "Saving…" : saving === "saved" ? "Saved" : ""}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button className="btn-outline py-1.5 text-xs" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Spinner size={11} /> : <FileUp size={14} />} {plot.background ? "Replace background" : "Add PDF / image"}
          </button>
          {plot.background && <button className="btn-ghost py-1.5 text-xs" onClick={() => update({ ...plot, background: null }, true)}><ImageOff size={14} /> Remove</button>}
          <button className="btn-ghost py-1.5 text-xs" title="Spread out cards that overlap" onClick={() => update({ ...plot, items: tidy(plot.items) })}><LayoutGrid size={14} /> Tidy up</button>
          <button className="btn-ghost py-1.5 text-xs" onClick={() => window.print()}><Printer size={14} /> Print</button>
        </div>
        <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); e.target.value = ""; }} />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="no-print w-44 shrink-0 overflow-y-auto border-r border-line p-3">
          {groups.map((g) => (
            <div key={g} className="mb-4">
              <div className="label mb-1.5">{g}</div>
              <div className="grid grid-cols-2 gap-1">
                {ITEM_TYPES.filter((t) => t.group === g).map(({ type, label, icon: Icon }) => (
                  <button key={type} onClick={() => add(type)} title={`Add ${label}`}
                    className="flex flex-col items-center gap-1 rounded-lg border border-line p-2 text-[10px] text-ink-soft transition hover:border-accent/50 hover:text-accent">
                    <Icon size={16} /> {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {plot.background && <p className="text-[10px] text-ink-faint">Background: {plot.background.source}</p>}
        </aside>

        <main className="min-w-0 flex-1 overflow-auto p-6">
          <div className="print-area mx-auto max-w-6xl">
            <div className="mb-2 hidden text-lg font-semibold print:block">{plot.name}</div>
            <PlotCanvas plot={plot} micLabels={new Map((micSetup.data?.channels ?? []).map((c) => [c.id, c.label]))} fitHeight={170} editable selectedId={selected} onSelect={setSelected} onChange={(it, done) => setItem(it, done)} />
          </div>
          <p className="no-print mt-2 text-center text-[11px] text-ink-faint">Click an item on the left to add it · drag to move · arrows nudge (⇧ for bigger steps) · ⌫ deletes · ⌘D duplicates</p>
        </main>

        <aside className="no-print w-64 shrink-0 overflow-y-auto border-l border-line p-4">
          {!item ? (
            <p className="text-sm text-ink-muted">Select an item to edit its label, rotation and what it shows each Sunday.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold">{(() => { const I = itemInfo(item.type).icon; return <I size={15} />; })()} {itemInfo(item.type).label}</div>
              <label className="block">
                <span className="label">Label</span>
                <input className="input mt-1" value={item.label} onChange={(e) => setItem({ ...item, label: e.target.value })} />
              </label>
              {(item.type === "riser" || item.type === "label") && (
                <label className="block">
                  <span className="label">Width</span>
                  <input type="range" min={3} max={80} value={Math.round((item.w ?? 0.2) * 100)} className="mt-1 w-full"
                    onChange={(e) => setItem({ ...item, w: Number(e.target.value) / 100 })} />
                </label>
              )}
              {item.type === "riser" && (
                <label className="block">
                  <span className="label">Depth</span>
                  <input type="range" min={3} max={80} value={Math.round((item.h ?? 0.15) * 100)} className="mt-1 w-full"
                    onChange={(e) => setItem({ ...item, h: Number(e.target.value) / 100 })} />
                </label>
              )}
              <label className="block">
                <span className="label flex items-center justify-between">Rotation <span className="normal-case tracking-normal text-ink-muted">{item.rotation}°</span></span>
                <div className="mt-1 flex items-center gap-2">
                  <input type="range" min={-180} max={180} step={5} value={item.rotation} className="flex-1" onChange={(e) => setItem({ ...item, rotation: Number(e.target.value) })} />
                  <button className="btn-ghost p-1" title="Rotate 45°" onClick={() => setItem({ ...item, rotation: ((item.rotation + 225) % 360) - 180 })}><RotateCw size={13} /></button>
                </div>
              </label>
              {item.type !== "riser" && item.type !== "label" && (
                <div>
                  <span className="label">Card color</span>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {CARD_COLORS.map((c) => (
                      <button key={c} title={c} onClick={() => setItem({ ...item, color: c })} style={{ background: c }}
                        className={clsx("h-6 w-6 rounded-md ring-1 ring-line-strong transition",
                          (item.color ?? DEFAULT_CARD.color).toLowerCase() === c.toLowerCase() && "ring-2 ring-accent ring-offset-2 ring-offset-surface")} />
                    ))}
                    <label title="Custom color" className="relative grid h-6 w-6 cursor-pointer place-items-center overflow-hidden rounded-md border border-dashed border-line-strong text-[10px] text-ink-muted">
                      +
                      <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={item.color ?? DEFAULT_CARD.color}
                        onChange={(e) => setItem({ ...item, color: e.target.value.toUpperCase() }, false)}
                        onBlur={(e) => setItem({ ...item, color: e.target.value.toUpperCase() })} />
                    </label>
                  </div>
                </div>
              )}
              {item.type !== "riser" && item.type !== "label" && (
                <label className="block">
                  <span className="label flex items-center justify-between">Corner radius <span className="normal-case tracking-normal text-ink-muted">{item.radius ?? DEFAULT_CARD.radius}px</span></span>
                  <input type="range" min={0} max={24} value={item.radius ?? DEFAULT_CARD.radius} className="mt-1 w-full"
                    onChange={(e) => setItem({ ...item, radius: Number(e.target.value) })} />
                </label>
              )}
              {item.type !== "riser" && item.type !== "label" && (
                <div>
                  <span className="label">Shows each Sunday</span>
                  <select className="input mt-1" value={item.link ? (item.link.kind === "mic" ? `mic:${item.link.channelId}` : "position") : ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setItem({ ...item, link: !v ? null : v === "position" ? { kind: "position", position: item.link?.kind === "position" ? item.link.position : "Vocals" } : { kind: "mic", channelId: v.slice(4) } });
                    }}>
                    <option value="">Nothing (just the label)</option>
                    <option value="position">Whoever’s in a position…</option>
                    {(micSetup.data?.channels.length ?? 0) > 0 && (
                      <optgroup label="Whoever has this mic">
                        {micSetup.data!.channels.map((c) => <option key={c.id} value={`mic:${c.id}`}>{c.label}</option>)}
                      </optgroup>
                    )}
                  </select>
                  {item.link?.kind === "position" && (
                    <>
                      <input className="input mt-2" list="plot-positions" value={item.link.position}
                        onChange={(e) => setItem({ ...item, link: { kind: "position", position: e.target.value } })} placeholder="Position, e.g. Bass" />
                      <datalist id="plot-positions">{positions.map((p) => <option key={p} value={p} />)}</datalist>
                    </>
                  )}
                </div>
              )}
              {item.type !== "riser" && item.type !== "label" && (
                <button className="btn-ghost w-full justify-start py-1 text-xs text-ink-muted"
                  onClick={() => update({ ...plot, items: plot.items.map((x) => (x.type === "riser" || x.type === "label" ? x : { ...x, color: item.color, radius: item.radius })) })}>
                  Use this color &amp; corners on every card
                </button>
              )}
              <div className="flex gap-2 border-t border-line pt-4">
                <button className="btn-outline flex-1 py-1.5 text-xs" onClick={duplicate}><Copy size={13} /> Duplicate</button>
                <button className={clsx("btn-outline flex-1 py-1.5 text-xs hover:border-bad/50 hover:text-bad")}
                  onClick={() => { update({ ...plot, items: plot.items.filter((x) => x.id !== item.id) }); setSelected(null); }}><Trash2 size={13} /> Delete</button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {pdf && (
        <Modal open onClose={() => setPdf(null)} title="Which page?" width={380}>
          <div className="space-y-3 p-5">
            <p className="text-sm text-ink-muted">{pdf.file.name} has {pdf.pages} pages. Pick the one to use as the background.</p>
            <select className="input" value={pdf.page} onChange={(e) => setPdf({ ...pdf, page: Number(e.target.value) })}>
              {Array.from({ length: pdf.pages }, (_, i) => <option key={i} value={i + 1}>Page {i + 1}</option>)}
            </select>
            <button className="btn-primary w-full" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const img = await pdfPageToImage(pdf.file, pdf.page);
                await applyBackground(img.dataUrl, img.width, img.height, `${pdf.file.name} (page ${pdf.page})`);
                setPdf(null);
              } catch (e) { toast.error("Couldn’t read that page", { description: (e as Error).message }); } finally { setBusy(false); }
            }}>{busy && <Spinner />} Use page {pdf.page}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
