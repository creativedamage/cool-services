"use client";
/**
 * Full screen on F: the page (or one element) takes over the whole screen, with no address bar,
 * tabs or menu bar. F or Esc leaves. Ignored while typing in a box.
 */
import { useCallback, useEffect, useState } from "react";

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

export function useFullScreenKey(target?: () => HTMLElement | null) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); return; }
    const el = target?.() ?? document.documentElement;
    void el.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  }, [target]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [toggle]);
  return { full, toggle };
}
