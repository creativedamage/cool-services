"use client";
/**
 * Sundays and Church Ops are two apps in one window: each has its own sidebar, look and home.
 * The switcher at the top of the sidebar goes back to where you were in the other one, and Sundays
 * reopens on the side you used last.
 */
import clsx from "clsx";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";

const LAST_APP = "cool:lastApp";
const LAST = { sundays: "cool:lastSundays", ops: "cool:lastOps" } as const;
export type AppSide = keyof typeof LAST;

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

/** The side last used (for the start-up screen). */
export const lastApp = (): AppSide => (get(LAST_APP) === "ops" ? "ops" : "sundays");

/** Remember where you are on this side. */
export function useRememberApp(side: AppSide, href: string) {
  useEffect(() => { set(LAST_APP, side); set(LAST[side], href); }, [side, href]);
}

export function AppSwitcher({ side }: { side: AppSide }) {
  const [hrefs, setHrefs] = useState({ sundays: "/dashboard", ops: "/ops" });
  useEffect(() => {
    const s = get(LAST.sundays), o = get(LAST.ops);
    setHrefs({ sundays: s && !s.startsWith("/ops") ? s : "/dashboard", ops: o?.startsWith("/ops") ? o : "/ops" });
  }, [side]);
  const tab = (key: AppSide, label: string, icon: React.ReactNode) => (
    <Link href={side === key ? "#" : hrefs[key]} onClick={(e) => side === key && e.preventDefault()}
      className={clsx("flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition",
        side === key ? (key === "ops" ? "bg-violet-soft text-violet" : "bg-accent-soft text-accent") : "text-ink-muted hover:bg-hover hover:text-ink-soft")}>
      {icon}{label}
    </Link>
  );
  return (
    <div className="mx-3 mb-3 flex rounded-lg border border-line p-0.5">
      {tab("sundays", "Sundays", <Logo size={14} />)}
      {tab("ops", "Church Ops", <Building2 size={13} />)}
    </div>
  );
}
