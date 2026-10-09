"use client";
/**
 * The pieces of a client-facing signing page (proposals, change orders): the light page shell, the
 * bottom sheet, banners, and the signature form (drawn or typed signature, name, title, email).
 */
import clsx from "clsx";
import { XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#eef1f5] font-sans text-[#0f172a] print:bg-white" style={{ colorScheme: "light" }}>{children}</div>;
}

export function Banner({ tone, icon, title, children }: { tone: "ok" | "warn" | "muted"; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const c = { ok: "border-[#a7f3d0] bg-[#ecfdf5] text-[#065f46]", warn: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]", muted: "border-[#e2e8f0] bg-white text-[#475569]" }[tone];
  return (
    <div className={clsx("mb-3 flex gap-3 rounded-xl border px-4 py-3", c)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div><div className="font-semibold">{title}</div><div className="text-sm opacity-90">{children}</div></div>
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="no-print fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 text-[#0f172a] shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button className="rounded-md p-1 text-[#64748b] hover:bg-[#f1f5f9]" onClick={onClose} aria-label="Close"><XCircle size={20} /></button></div>
        {children}
      </div>
    </div>
  );
}

export const input = "w-full rounded-lg border border-[#cbd5e1] bg-white px-3 py-2.5 text-[16px] text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20";
export const label = "mb-1 block text-sm font-medium text-[#334155]";
export const when = (d: string) => new Date(d).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export interface Signed { name: string; title: string; email: string; signature: string }

/** Name, title, email, signature pad and the "I agree" box. `onSign` throws to show an error. */
export function SignForm({ defaultName, defaultEmail, summary, agreeText, button, onSign }: { defaultName: string; defaultEmail: string; summary: React.ReactNode; agreeText: string; button: string; onSign: (s: Signed) => Promise<void> }) {
  const [name, setName] = useState(defaultName);
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [drawn, setDrawn] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pad = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = pad.current; if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio; c.height = c.clientHeight * ratio;
    const g = c.getContext("2d")!;
    g.scale(ratio, ratio); g.lineWidth = 2.4; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0f172a";
    let down = false, last: [number, number] | null = null;
    const at = (e: PointerEvent): [number, number] => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const start = (e: PointerEvent) => { if (mode !== "draw") return; down = true; last = at(e); c.setPointerCapture(e.pointerId); };
    const moveTo = (e: PointerEvent) => {
      if (!down || !last) return;
      const p = at(e);
      g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke();
      last = p; setDrawn(true);
    };
    const end = () => { down = false; last = null; };
    c.addEventListener("pointerdown", start); c.addEventListener("pointermove", moveTo); c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
    return () => { c.removeEventListener("pointerdown", start); c.removeEventListener("pointermove", moveTo); c.removeEventListener("pointerup", end); c.removeEventListener("pointercancel", end); };
  }, [mode]);
  // Typed: the name, drawn as a signature, as it's typed.
  useEffect(() => { if (mode === "type" && pad.current) typed(pad.current, name); }, [mode, name]);

  const clear = () => { const c = pad.current; if (!c) return; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setDrawn(false); if (mode === "type") typed(c, name); };
  const hasSig = mode === "draw" ? drawn : name.trim().length >= 2;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!hasSig) return setError(mode === "draw" ? "Draw your signature in the box (or type it instead)." : "Type your name.");
    setBusy(true);
    try { await onSign({ name, title, email, signature: flatten(pad.current!) }); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="rounded-xl bg-[#f8fafc] px-4 py-3 text-sm">{summary}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className={label} htmlFor="sig-name">Full name</label><input id="sig-name" required minLength={2} autoComplete="name" className={input} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className={label} htmlFor="sig-title">Title <span className="font-normal text-[#94a3b8]">(optional)</span></label><input id="sig-title" autoComplete="organization-title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Executive Pastor" /></div>
      </div>
      <div><label className={label} htmlFor="sig-email">Email</label><input id="sig-email" type="email" required autoComplete="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className={label}>Signature</span>
          <div className="flex gap-1 text-xs">
            {(["draw", "type"] as const).map((m) => <button key={m} type="button" onClick={() => { setMode(m); setDrawn(false); }} className={clsx("rounded-md px-2 py-1", mode === m ? "bg-[#0f766e] text-white" : "text-[#475569] hover:bg-[#f1f5f9]")}>{m === "draw" ? "Draw" : "Type"}</button>)}
            <button type="button" onClick={clear} className="rounded-md px-2 py-1 text-[#475569] hover:bg-[#f1f5f9]">Clear</button>
          </div>
        </div>
        <canvas ref={pad} aria-label={mode === "draw" ? "Draw your signature here" : "Your typed signature"} className={clsx("h-36 w-full touch-none rounded-xl border-2 border-dashed bg-white", mode === "draw" ? "cursor-crosshair border-[#94a3b8]" : "border-[#cbd5e1]")} />
        <div className="mt-1 text-xs text-[#94a3b8]">{mode === "draw" ? "Use your finger, a stylus or the mouse." : "Your name, as your signature."}</div>
      </div>
      <label className="flex items-start gap-2.5 text-sm text-[#334155]">
        <input type="checkbox" required className="mt-0.5 h-4 w-4 accent-[#0f766e]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>{agreeText}</span>
      </label>
      {error && <p className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c]">{error}</p>}
      <button className="w-full rounded-lg bg-[#0f766e] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#115e59] disabled:opacity-60" disabled={busy || !agree}>{busy ? "Signing…" : button}</button>
    </form>
  );
}

/** A typed name drawn as a signature. */
function typed(c: HTMLCanvasElement, name: string) {
  const g = c.getContext("2d")!;
  const w = c.clientWidth, h = c.clientHeight;
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#0f172a"; g.textBaseline = "middle"; g.textAlign = "center";
  let size = 46;
  g.font = `italic ${size}px "Snell Roundhand", "Brush Script MT", "Segoe Script", cursive`;
  while (size > 18 && g.measureText(name).width > w - 32) { size -= 2; g.font = `italic ${size}px "Snell Roundhand", "Brush Script MT", "Segoe Script", cursive`; }
  g.fillText(name, w / 2, h / 2);
}

/** The signature as a small white-backed PNG. */
function flatten(c: HTMLCanvasElement) {
  const out = document.createElement("canvas");
  const scale = Math.min(1, 900 / c.width);
  out.width = Math.round(c.width * scale); out.height = Math.round(c.height * scale);
  const g = out.getContext("2d")!;
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, out.width, out.height);
  g.drawImage(c, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
