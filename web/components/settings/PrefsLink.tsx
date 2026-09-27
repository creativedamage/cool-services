"use client";
import { openPrefs } from "@/lib/prefs";

/** A link to a Preferences section: its own window in the Mac app, a page in a browser. */
export function PrefsLink({ section, className, title, children }: { section: string; className?: string; title?: string; children: React.ReactNode }) {
  return (
    <a href={`/preferences#${section}`} className={className} title={title} onClick={(e) => { e.preventDefault(); void openPrefs(section); }}>
      {children}
    </a>
  );
}
