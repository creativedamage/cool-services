"use client";
/**
 * Long text that starts folded to a few lines (so the page doesn't turn into a long scroll) with
 * "Show more" to open it. Short text shows in full with no button.
 */
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

export function Expandable({ children, lines = 2, className }: { children: React.ReactNode; lines?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => { if (!open) setOverflows(el.scrollHeight > el.clientHeight + 2); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, children]);
  return (
    <div className={className}>
      <div ref={ref} className="relative overflow-hidden" style={open ? undefined : { maxHeight: `${lines * 1.625}em` }}>
        {children}
        {!open && overflows && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[1.2em] bg-gradient-to-t from-[rgb(var(--c-surface))] to-transparent" />}
      </div>
      {(overflows || open) && (
        <button onClick={() => setOpen(!open)} className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline">
          {open ? "Show less" : "Show more"} <ChevronDown size={11} className={clsx("transition", open && "rotate-180")} />
        </button>
      )}
    </div>
  );
}
