"use client";
/**
 * The client's proposal page (sundays-ops.vercel.app/proposal?t=…): no sign-in, the link is the key.
 * They read the proposal and sign it (drawn or typed signature), ask for changes, or decline. Made
 * for a phone as much as a desk; Print saves a PDF.
 */
import clsx from "clsx";
import { CheckCircle2, MessageSquareText, PenLine, Printer, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientProposalPage } from "@shared/ops/jobs";
import { fmtMoney, OpsError, opsPublic } from "@/lib/ops";
import { ProposalDoc } from "./ProposalDoc";

type Load = { page: ClientProposalPage } | { error: string; draft?: boolean } | null;
const when = (d: string) => new Date(d).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function ClientProposal({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>(null);
  const [sheet, setSheet] = useState<"sign" | "changes" | "decline" | null>(null);
  const fetchPage = useCallback(async () => {
    if (!token) return setLoad({ error: "This link is missing part of its address. Open it again from the email." });
    try { setLoad({ page: await opsPublic<ClientProposalPage>(`/public/proposals/${encodeURIComponent(token)}`) }); }
    catch (e) { setLoad({ error: (e as Error).message, draft: e instanceof OpsError && e.body.status === "draft" }); }
  }, [token]);
  useEffect(() => { void fetchPage(); }, [fetchPage]);

  if (!load) return <Shell><div className="py-24 text-center text-[#64748b]">Loading the proposal…</div></Shell>;
  if ("error" in load) {
    return (
      <Shell>
        <div className="mx-auto max-w-md py-24 text-center">
          <div className="text-lg font-semibold text-[#0f172a]">{load.draft ? "This proposal is being updated" : "We can’t open this proposal"}</div>
          <p className="mt-2 text-[#475569]">{load.error}</p>
        </div>
      </Shell>
    );
  }
  const p = load.page;
  const { quote, org } = p;
  const done = quote.status === "ACCEPTED" || quote.status === "CONVERTED";
  const answered = (page: ClientProposalPage) => { setLoad({ page }); setSheet(null); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return (
    <Shell>
      <div className="no-print sticky top-0 z-20 border-b border-[#e2e8f0] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[8.5in] items-center gap-3 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[#0f172a]">{org.name ?? "Proposal"}</div>
            <div className="truncate text-xs text-[#64748b]">Proposal {quote.number} · {fmtMoney(quote.totals.totalCents)}</div>
          </div>
          <button className="inline-flex items-center gap-1.5 rounded-lg border border-[#cbd5e1] px-3 py-1.5 text-sm text-[#334155] hover:bg-[#f1f5f9]" onClick={() => window.print()}><Printer size={14} /> <span className="hidden sm:inline">Print or save PDF</span><span className="sm:hidden">PDF</span></button>
        </div>
      </div>

      <div className="mx-auto max-w-[8.5in] px-3 pb-32 pt-4 sm:px-4 print:p-0">
        <div className="no-print">
          {done && p.signature && (
            <Banner tone="ok" icon={<CheckCircle2 size={18} />} title="Signed. Thank you!">
              {p.signature.signerName}{p.signature.signerTitle ? `, ${p.signature.signerTitle}` : ""} signed this proposal on {when(p.signature.signedAt)} for {fmtMoney(p.signature.totalCents)}. {org.name ?? "The team"} will be in touch about next steps.
            </Banner>
          )}
          {done && !p.signature && <Banner tone="ok" icon={<CheckCircle2 size={18} />} title="Accepted">This proposal has been accepted.</Banner>}
          {p.answer?.kind === "CHANGES" && (
            <Banner tone="warn" icon={<MessageSquareText size={18} />} title="You asked for changes">
              {p.answer.note ? <>“{p.answer.note}”. </> : null}{org.name ?? "The team"} is working on an updated proposal. This same link will show it.
            </Banner>
          )}
          {p.answer?.kind === "DECLINED" && <Banner tone="muted" icon={<XCircle size={18} />} title="Declined">You declined this proposal on {when(p.answer.at)}.{p.answer.note ? ` “${p.answer.note}”` : ""}</Banner>}
          {p.expired && <Banner tone="warn" icon={<XCircle size={18} />} title="This proposal has expired">It was valid until {quote.validUntil ? new Date(quote.validUntil).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "an earlier date"}. Ask {org.name ?? "the team"} for an updated one.</Banner>}
        </div>

        <div className="ops-proposal mt-3 rounded-xl bg-white p-5 text-[#111] shadow-sm ring-1 ring-[#e2e8f0] sm:p-10 print:rounded-none print:p-0 print:shadow-none print:ring-0">
          <ProposalDoc data={{ quote, org, logo: p.logo }} signature={p.signature ? <SignedBlock p={p} /> : p.canAnswer ? null : undefined} />
        </div>
      </div>

      {p.canAnswer && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-[#e2e8f0] bg-white/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="mx-auto flex max-w-[8.5in] flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
            <div className="hidden flex-1 text-sm text-[#475569] sm:block">Ready? Sign to accept {fmtMoney(quote.totals.totalCents)}{quote.totals.depositCents > 0 ? `, with ${fmtMoney(quote.totals.depositCents)} due at approval` : ""}.</div>
            <button className="order-3 rounded-lg px-3 py-2.5 text-sm text-[#64748b] hover:bg-[#f1f5f9] sm:order-none" onClick={() => setSheet("decline")}>Decline</button>
            <button className="flex-1 whitespace-nowrap rounded-lg border border-[#cbd5e1] px-3 py-2.5 text-sm font-medium text-[#334155] hover:bg-[#f1f5f9] sm:flex-none" onClick={() => setSheet("changes")}>Ask for changes</button>
            <button className="flex-1 whitespace-nowrap rounded-lg bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#115e59] sm:flex-none" onClick={() => setSheet("sign")}><PenLine size={15} className="mr-1.5 hidden sm:inline" />Sign and accept</button>
          </div>
        </div>
      )}

      {sheet === "sign" && <SignSheet token={token} page={p} onClose={() => setSheet(null)} onDone={answered} onStale={() => { setSheet(null); void fetchPage(); }} />}
      {(sheet === "changes" || sheet === "decline") && <AnswerSheet token={token} kind={sheet} page={p} onClose={() => setSheet(null)} onDone={answered} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#eef1f5] font-sans text-[#0f172a] print:bg-white" style={{ colorScheme: "light" }}>{children}</div>;
}

function Banner({ tone, icon, title, children }: { tone: "ok" | "warn" | "muted"; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const c = { ok: "border-[#a7f3d0] bg-[#ecfdf5] text-[#065f46]", warn: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]", muted: "border-[#e2e8f0] bg-white text-[#475569]" }[tone];
  return (
    <div className={clsx("mb-3 flex gap-3 rounded-xl border px-4 py-3", c)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div><div className="font-semibold">{title}</div><div className="text-sm opacity-90">{children}</div></div>
    </div>
  );
}

function SignedBlock({ p }: { p: ClientProposalPage }) {
  const s = p.signature!;
  return (
    <section className="mt-10 break-inside-avoid border-t border-[#e2e8f0] pt-4 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">Accepted</div>
      <div className="mt-1">Signed electronically by <b>{s.signerName}</b>{s.signerTitle ? `, ${s.signerTitle}` : ""} on {when(s.signedAt)} for {fmtMoney(s.totalCents)}.</div>
    </section>
  );
}

/* ───────────── Signing ───────────── */

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

const input = "w-full rounded-lg border border-[#cbd5e1] bg-white px-3 py-2.5 text-[16px] text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20";
const label = "mb-1 block text-sm font-medium text-[#334155]";

function SignSheet({ token, page, onClose, onDone, onStale }: { token: string; page: ClientProposalPage; onClose: () => void; onDone: (p: ClientProposalPage) => void; onStale: () => void }) {
  const [name, setName] = useState(page.quote.customer.contactName ?? "");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState(page.quote.customer.email ?? "");
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [drawn, setDrawn] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pad = useRef<HTMLCanvasElement>(null);
  const t = page.quote.totals;

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

  async function sign(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!hasSig) return setError(mode === "draw" ? "Draw your signature in the box (or type it instead)." : "Type your name.");
    setBusy(true);
    try {
      const signature = flatten(pad.current!);
      onDone(await opsPublic<ClientProposalPage>(`/public/proposals/${encodeURIComponent(token)}/sign`, { name, title, email, signature, totalCents: t.totalCents, agree }));
    } catch (err) {
      if (err instanceof OpsError && err.body.status === "changed") { onStale(); return; }
      setError((err as Error).message); setBusy(false);
    }
  }

  return (
    <Sheet title="Sign and accept" onClose={onClose}>
      <form className="space-y-4" onSubmit={sign}>
        <div className="rounded-xl bg-[#f8fafc] px-4 py-3 text-sm">
          <div className="flex justify-between"><span className="text-[#64748b]">Total</span><b className="tabular-nums">{fmtMoney(t.totalCents)}</b></div>
          {t.depositCents > 0 && <div className="mt-0.5 flex justify-between"><span className="text-[#64748b]">Due at approval</span><span className="tabular-nums">{fmtMoney(t.depositCents)}</span></div>}
        </div>
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
          <span>I accept this proposal and its terms for {fmtMoney(t.totalCents)}, and I agree that my electronic signature is as valid as signing on paper.</span>
        </label>
        {error && <p className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c]">{error}</p>}
        <button className="w-full rounded-lg bg-[#0f766e] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#115e59] disabled:opacity-60" disabled={busy || !agree}>{busy ? "Signing…" : `Sign and accept ${fmtMoney(t.totalCents)}`}</button>
      </form>
    </Sheet>
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

function AnswerSheet({ token, kind, page, onClose, onDone }: { token: string; kind: "changes" | "decline"; page: ClientProposalPage; onClose: () => void; onDone: (p: ClientProposalPage) => void }) {
  const [name, setName] = useState(page.quote.customer.contactName ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = kind === "changes";
  return (
    <Sheet title={changes ? "Ask for changes" : "Decline the proposal"} onClose={onClose}>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { onDone(await opsPublic<ClientProposalPage>(`/public/proposals/${encodeURIComponent(token)}/${kind}`, { name, note })); }
        catch (err) { setError((err as Error).message); setBusy(false); }
      }}>
        <p className="text-sm text-[#475569]">{changes ? `Tell ${page.org.name ?? "the team"} what you'd like different. They'll send an updated proposal to this same link.` : `Let ${page.org.name ?? "the team"} know you won't be going ahead. A reason helps, but it's up to you.`}</p>
        <div><label className={label} htmlFor="ans-name">Your name</label><input id="ans-name" className={input} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className={label} htmlFor="ans-note">{changes ? "What should change?" : "Reason (optional)"}</label><textarea id="ans-note" rows={5} required={changes} className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder={changes ? "e.g. Could you add a second confidence monitor and drop the subwoofer?" : ""} /></div>
        {error && <p className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c]">{error}</p>}
        <button className={clsx("w-full rounded-lg px-4 py-3 text-[15px] font-semibold text-white disabled:opacity-60", changes ? "bg-[#0f766e] hover:bg-[#115e59]" : "bg-[#475569] hover:bg-[#334155]")} disabled={busy}>{busy ? "Sending…" : changes ? "Send my changes" : "Decline"}</button>
      </form>
    </Sheet>
  );
}
