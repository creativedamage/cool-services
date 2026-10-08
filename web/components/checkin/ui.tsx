"use client";
/** Small building blocks of the check-in website (phone-sized, safe-area aware). */
import { useState } from "react";

export function Shell({ children }: { children?: React.ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-col bg-canvas text-ink" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>{children}</div>;
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="m-auto flex w-full max-w-sm flex-col items-center p-8 text-center" style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)" }}>{children}</div>;
}

export function AppMark({ size = 64 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/checkin/icon.svg" alt="" width={size} height={size} className="rounded-[22%] shadow-lg" />;
}

export function Face({ name, src, size = 40 }: { name: string; src: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
  const style = { width: size, height: size };
  // eslint-disable-next-line @next/next/no-img-element
  return src && !broken ? <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover" onError={() => setBroken(true)} />
    : <span style={style} className="grid shrink-0 place-items-center rounded-full bg-hover text-xs font-semibold text-ink-muted">{initials}</span>;
}

export function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={onClose}>
      <div className="w-full rounded-t-3xl border-t border-line bg-surface p-5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
