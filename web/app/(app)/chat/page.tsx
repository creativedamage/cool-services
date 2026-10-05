"use client";
/**
 * Chat: Planning Center's own Chat, shown in this page's content area by the Mac app (Planning
 * Center has no public Chat API). See current conversations, start new ones, message teams and
 * people, exactly as in Planning Center.
 */
import clsx from "clsx";
import { ExternalLink, Home, MessageCircle, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const CHAT = "https://chat.planningcenteronline.com/";
const post = (body: unknown) =>
  fetch("/api/desktop/embed", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function ChatPage() {
  const box = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/desktop/embed", { credentials: "same-origin" }).then((r) => r.json()).then((j) => setAvailable(Boolean(j.available))).catch(() => setAvailable(false));
  }, []);

  // Keep the native Chat view exactly over this box; take it away when leaving the page.
  useEffect(() => {
    if (!available || !box.current) return;
    const el = box.current;
    let raf = 0;
    const place = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        void post({ action: "show", url: CHAT, bounds: { x: r.left, y: r.top, width: r.width, height: r.height } });
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    return () => { ro.disconnect(); window.removeEventListener("resize", place); cancelAnimationFrame(raf); void post({ action: "hide" }); };
  }, [available]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-6 py-3 pr-28">
        <MessageCircle size={18} className="text-accent" />
        <div>
          <h1 className="text-lg font-semibold leading-tight">Chat</h1>
          <p className="text-[11px] text-ink-muted">Planning Center Chat: your conversations, teams and direct messages.</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {available && <>
            <button className="btn-ghost py-1 text-xs" onClick={() => void post({ action: "home" })}><Home size={13} /> All chats</button>
            <button className="btn-ghost py-1 text-xs" onClick={() => void post({ action: "reload" })}><RotateCw size={13} /> Reload</button>
          </>}
          <a className="btn-ghost py-1 text-xs" href={CHAT} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open in browser</a>
        </div>
      </header>
      <div ref={box} className={clsx("relative min-h-0 flex-1", available && "bg-canvas")}>
        {available === false && (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="max-w-md">
              <MessageCircle className="mx-auto text-accent" size={28} />
              <h2 className="mt-3 font-semibold">Chat opens inside the Sundays Mac app</h2>
              <p className="mt-1 text-sm text-ink-muted">In a browser, open Planning Center Chat in its own tab.</p>
              <a className="btn-primary mt-4" href={CHAT} target="_blank" rel="noreferrer">Open Planning Center Chat</a>
            </div>
          </div>
        )}
        {available && <div className="grid h-full place-items-center text-sm text-ink-faint">Loading Planning Center Chat…</div>}
      </div>
    </div>
  );
}
