"use client";
import clsx from "clsx";
import { Film, Music2, Type } from "lucide-react";
import type { PlanDetail } from "@shared/types";
import { clock, mmss } from "@/lib/format";
import { Expandable } from "@/components/Expandable";

/** Run sheet with a live clock column computed from the first service time. */
export function RunSheet({ plan }: { plan: PlanDetail }) {
  const firstService = plan.times.find((t) => t.kind === "service");
  const during = plan.items.filter((i) => i.servicePosition === "during");
  const runtime = during.reduce((n, i) => n + i.lengthSec, 0);

  // Items before the service start count backwards from it.
  const pre = plan.items.filter((i) => i.servicePosition === "pre");
  const start = firstService ? Date.parse(firstService.startsAt) - pre.reduce((n, i) => n + i.lengthSec, 0) * 1000 : null;
  let offset = 0;

  return (
    <section className="panel self-start overflow-hidden">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Run sheet</div>
          <div className="text-[11px] text-ink-muted">{plan.items.length} items · service runs {mmss(runtime)}</div>
        </div>
        {firstService && <div className="text-[11px] text-ink-muted">clock for {firstService.name || clock(firstService.startsAt)}</div>}
      </header>
      <ol>
        {plan.items.map((item) => {
          const at = start !== null ? new Date(start + offset * 1000).toISOString() : null;
          offset += item.lengthSec;
          if (item.kind === "header") {
            return (
              <li key={item.id} className="bg-canvas/60 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                {item.title}
              </li>
            );
          }
          const Icon = item.kind === "song" ? Music2 : item.kind === "media" ? Film : Type;
          return (
            <li key={item.id} className={clsx("flex gap-3 border-t border-line/60 px-4 py-2.5",
              item.servicePosition !== "during" && "opacity-60")}>
              <div className="w-14 shrink-0 pt-0.5 text-right font-mono text-[11px] text-ink-muted">{at ? clock(at).replace(" ", " ") : ""}</div>
              <Icon size={14} className={clsx("mt-0.5 shrink-0", item.kind === "song" ? "text-violet" : "text-ink-faint")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 break-words text-sm font-medium">{item.title}</span>
                  {item.songKey && <span className="mt-0.5 shrink-0 rounded bg-violet-soft px-1.5 font-mono text-[10px] text-violet">{item.songKey}</span>}
                </div>
                {item.description && (
                  <Expandable lines={2} className="mt-0.5 text-xs leading-relaxed">
                    <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-muted">{item.description}</div>
                  </Expandable>
                )}
                {item.notes.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {item.notes.map((n, i) => (
                      <Expandable key={i} lines={2} className="rounded-md border border-line px-2 py-1 text-[11px] leading-relaxed">
                        <div className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-soft">
                          <span className="font-medium text-ink-muted">{n.category}:</span> {n.body}
                        </div>
                      </Expandable>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-ink-muted">{item.lengthSec ? mmss(item.lengthSec) : ""}</div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
