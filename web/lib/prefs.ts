"use client";
/**
 * Preferences open in their own window in the Mac app (Cool Services → Preferences…, ⌘,). In a
 * browser they open as a page. Sections ("smaart", "paging"…) pick the tab they're on.
 */
export type PrefsTab = "about" | "appearance" | "startup" | "campuses" | "audio" | "network" | "video";

export const SECTION_TAB: Record<string, PrefsTab> = {
  about: "about", updates: "about",
  appearance: "appearance", logo: "appearance",
  startup: "startup", start: "startup", campuses: "campuses",
  audio: "audio", console: "audio", waves: "audio", smaart: "audio",
  network: "network", paging: "network", ipads: "network",
  video: "video", "pro-computers": "video",
};

export async function openPrefs(section = "about") {
  try {
    const r = await fetch("/api/desktop/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section }) });
    if (r.ok) return;
  } catch { /* not the Mac app */ }
  window.location.href = `/preferences#${section}`;
}

/** Other windows (the main window, Preferences) refresh when something is saved in one of them. */
export const CHANGES = "coolservices.changes";
