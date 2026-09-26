"use client";
/** Draws a stage plot: background (PDF page / image / blank stage) plus draggable items. */
import clsx from "clsx";
import { useRef } from "react";
import { Mic } from "lucide-react";
import type { PlotItem, PlotPerson, StagePlot } from "@shared/types";
import { DEFAULT_CARD, itemInfo, textOn } from "@/lib/stage";

export function PlotCanvas({ plot, editable, selectedId, onSelect, onChange, people, micLabels, className, fitHeight }: {
  plot: Pick<StagePlot, "background" | "items">;
  editable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (item: PlotItem, done: boolean) => void;
  /** Who each card shows for a service (name, position, mics). */
  people?: Map<string, PlotPerson[]>;
  /** Mic channel id → label, so cards linked to a mic can say which one while editing. */
  micLabels?: Map<string, string>;
  className?: string;
  /** Space (px) taken by headers above the canvas; the canvas shrinks to fit the rest of the window. */
  fitHeight?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const ratio = plot.background ? plot.background.width / plot.background.height : 16 / 10;
  // Fit the whole stage on screen: never taller than the window allows.
  const fit = fitHeight ? { maxWidth: `min(100%, calc((100vh - ${fitHeight}px) * ${ratio}))`, marginInline: "auto" } : {};

  const toRel = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const clamp = (n: number) => Math.min(1, Math.max(0, n));

  return (
    <div ref={box} onPointerDown={() => editable && onSelect?.(null)}
      style={{ aspectRatio: String(ratio), ...fit }}
      className={clsx("relative w-full select-none overflow-hidden rounded-xl border border-line [container-type:inline-size]", plot.background ? "bg-white" : "bg-canvas", className)}>
      {plot.background ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/stage/files/${plot.background.fileId}`} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
      ) : (
        <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgb(var(--c-line)/.6)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--c-line)/.6)_1px,transparent_1px)] [background-size:5%_8%]">
          <div className="absolute inset-x-0 top-2 text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-ink-faint">Upstage</div>
          <div className="absolute inset-x-0 bottom-2 text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-ink-faint">Downstage · audience</div>
        </div>
      )}

      {/* Risers first so they sit underneath everything standing on them. */}
      {[...plot.items].sort((a, b) => Number(b.type === "riser") - Number(a.type === "riser")).map((it) => {
        const info = itemInfo(it.type);
        const Icon = info.icon;
        const who = people?.get(it.id);
        const selected = selectedId === it.id;
        const handlers = editable ? {
          onPointerDown: (e: React.PointerEvent) => {
            e.stopPropagation();
            onSelect?.(it.id);
            const p = toRel(e);
            drag.current = { id: it.id, dx: p.x - it.x, dy: p.y - it.y, moved: false };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          },
          onPointerMove: (e: React.PointerEvent) => {
            if (drag.current?.id !== it.id) return;
            const p = toRel(e);
            drag.current.moved = true;
            onChange?.({ ...it, x: clamp(p.x - drag.current.dx), y: clamp(p.y - drag.current.dy) }, false);
          },
          onPointerUp: (e: React.PointerEvent) => {
            if (drag.current?.id !== it.id) return;
            const p = toRel(e);
            if (drag.current.moved) onChange?.({ ...it, x: clamp(p.x - drag.current.dx), y: clamp(p.y - drag.current.dy) }, true);
            drag.current = null;
          },
        } : {};

        const pos = { left: `${it.x * 100}%`, top: `${it.y * 100}%` };
        if (it.type === "riser") {
          return (
            <div key={it.id} {...handlers}
              style={{ ...pos, width: `${(it.w ?? 0.2) * 100}%`, height: `${(it.h ?? 0.15) * 100}%`, transform: `translate(-50%,-50%) rotate(${it.rotation}deg)` }}
              className={clsx("absolute flex items-start justify-start rounded-md border-2 border-dashed px-[0.6cqw] py-[0.3cqw] text-[0.9cqw] font-semibold uppercase tracking-wider",
                plot.background ? "border-gray-500/70 bg-gray-400/20 text-gray-800" : "border-ink-muted/60 bg-hover/40 text-ink-soft",
                editable && "cursor-move", selected && "outline outline-2 outline-offset-2 outline-accent")}>
              {it.label}
            </div>
          );
        }
        if (it.type === "label") {
          return (
            <div key={it.id} {...handlers}
              style={{ ...pos, width: `${(it.w ?? 0.2) * 100}%`, transform: `translate(-50%,-50%) rotate(${it.rotation}deg)` }}
              className={clsx("absolute rounded px-1 text-center text-xs font-semibold text-ink",
                plot.background && "bg-white/80 text-black", editable && "cursor-move", selected && "outline outline-2 outline-accent")}>
              {it.label}
            </div>
          );
        }
        // Everything else is a card: who's there, their position, and their mic(s).
        const fill = it.color ?? DEFAULT_CARD.color;
        const ink = textOn(fill);
        const linkText = it.link?.kind === "mic" ? micLabels?.get(it.link.channelId) ?? "Mic"
          : it.link?.kind === "position" ? it.link.position : null;
        return (
          <div key={it.id} {...handlers}
            style={{ ...pos, transform: `translate(-50%,-50%) rotate(${it.rotation}deg)`, background: fill, color: ink, borderRadius: it.radius ?? DEFAULT_CARD.radius }}
            className={clsx("absolute w-[14cqw] px-[0.9cqw] py-[0.6cqw] shadow-md ring-1 ring-black/10", editable && "cursor-move",
              selected && "outline outline-2 outline-offset-2 outline-accent")}>
            <div className="flex items-center gap-[0.4cqw] text-[0.85cqw] font-semibold uppercase tracking-wider opacity-75">
              <Icon className="h-[1cqw] w-[1cqw] shrink-0" /><span className="truncate">{it.label}</span>
            </div>
            {who ? who.map((p) => (
              <div key={p.name} className="mt-[0.4cqw] leading-tight">
                <div className="truncate text-[1.35cqw] font-bold">{p.name}</div>
                {p.position && <div className="truncate text-[1cqw] opacity-80">{p.position}</div>}
                {p.mics.length > 0 && (
                  <div className="mt-[0.3cqw] flex flex-wrap gap-[0.3cqw]">
                    {p.mics.map((m) => (
                      <span key={m} style={{ background: ink === "#FFFFFF" ? "rgba(255,255,255,.2)" : "rgba(15,23,42,.12)" }}
                        className="inline-flex items-center gap-[0.2cqw] rounded px-[0.4cqw] text-[0.9cqw] font-semibold"><Mic className="h-[0.85cqw] w-[0.85cqw]" />{m}</span>
                    ))}
                  </div>
                )}
              </div>
            )) : (
              <div className="mt-[0.4cqw] leading-tight">
                <div className="truncate text-[1.35cqw] font-bold opacity-90">{people ? "Open" : linkText ?? it.label}</div>
                <div className="truncate text-[1cqw] opacity-70">
                  {people ? (linkText ?? "") : it.link?.kind === "mic" ? "Whoever has this mic" : it.link?.kind === "position" ? "Whoever’s in this position" : "Not linked"}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
