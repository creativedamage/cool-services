"use client";
import type { ThemePref } from "@shared/types";

export const THEME_KEY = "coolservices.theme";

/** Runs before the page paints (inlined in <head>) so there's no dark/light flash. */
export const themeBootScript = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"dark";var d=p==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;document.documentElement.dataset.theme=d;}catch(e){}})();`;

let mq: MediaQueryList | null = null;
const onSystemChange = () => apply("system");

function apply(pref: ThemePref) {
  const resolved = pref === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : pref;
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/** Apply a theme choice now, remember it, and follow the Mac's appearance when set to System. */
export function setTheme(pref: ThemePref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* ignore */ }
  mq?.removeEventListener("change", onSystemChange);
  mq = null;
  if (pref === "system") {
    mq = matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", onSystemChange);
  }
  return apply(pref);
}

export const currentTheme = (): "dark" | "light" =>
  (typeof document !== "undefined" && document.documentElement.dataset.theme === "light") ? "light" : "dark";
