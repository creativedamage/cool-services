"use client";
import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { RosterStatus } from "@shared/types";
import { initials } from "@/lib/format";

/* Deterministic hue per name so initials avatars are stable. */
const HUES = ["#4F9CFF", "#34D399", "#A78BFA", "#F59E0B", "#FB7185", "#22D3EE", "#F472B6"];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

export function Avatar({ name, src, size = 36, ring }: { name: string; src: string | null; size?: number; ring?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: size * 0.38 };
  const ringCls = ring ? `ring-2 ${ring} ring-offset-2 ring-offset-raised` : "";
  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={name} style={style} onError={() => setBroken(true)}
        className={clsx("shrink-0 rounded-full object-cover bg-hover", ringCls)} />
    );
  }
  const c = hue(name);
  return (
    <div style={{ ...style, background: `${c}26`, color: c }}
      className={clsx("grid shrink-0 place-items-center rounded-full font-semibold", ringCls)}>
      {initials(name)}
    </div>
  );
}

const STATUS: Record<RosterStatus, { label: string; cls: string; dot: string }> = {
  C: { label: "Confirmed", cls: "bg-ok-soft text-ok", dot: "bg-ok" },
  U: { label: "Pending", cls: "bg-warn-soft text-warn", dot: "bg-warn" },
  D: { label: "Declined", cls: "bg-bad-soft text-bad", dot: "bg-bad" },
};

export function StatusPill({ status }: { status: RosterStatus }) {
  const s = STATUS[status];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", s.cls)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "accent" | "ok" | "warn" | "bad" | "violet" }) {
  const tones = {
    muted: "bg-hover text-ink-muted",
    accent: "bg-accent-soft text-accent",
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad",
    violet: "bg-violet-soft text-violet",
  };
  return <span className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>;
}

export function Modal({ open, onClose, title, children, width = 560 }: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; width?: number;
}) {
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}
        className="panel w-full animate-fade-up bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold">{title}</div>
          <button className="btn-ghost -mr-2 p-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 bg-black/40" onMouseDown={onClose}>
      <aside onMouseDown={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 flex h-full w-full max-w-[460px] animate-slide-in flex-col border-l border-line bg-surface shadow-2xl">
        {children}
      </aside>
    </div>
  );
}

function useEsc(active: boolean, fn: () => void) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && fn();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, fn]);
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size }}
      className="inline-block animate-spin rounded-full border-2 border-current border-r-transparent opacity-70" />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-hover/70", className)} />;
}
