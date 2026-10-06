"use client";
/**
 * Sundays, Sundays | Operations and Sundays | AVL are separate apps in one window: each has its own
 * sidebar, look and home. The switcher at the top of the sidebar goes back to where you were in the
 * other one, and Sundays reopens on the side you used last. Operations and AVL only show for people
 * who have access to them.
 */
import clsx from "clsx";
import { AudioLines, Building2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { useOpsMe, useOpsSession } from "@/lib/ops";

const LAST_APP = "cool:lastApp";
const LAST = { sundays: "cool:lastSundays", ops: "cool:lastOps", avl: "cool:lastAvl", admin: "cool:lastAdmin" } as const;
export type AppSide = keyof typeof LAST;
const HOME: Record<AppSide, string> = { sundays: "/dashboard", ops: "/ops", avl: "/avl", admin: "/admin" };

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

/** The side last used (for the start-up screen). */
export const lastApp = (): AppSide => { const v = get(LAST_APP); return v === "ops" || v === "avl" || v === "admin" ? v : "sundays"; };
/** Where you were last on a side. */
export const lastHref = (side: AppSide) => { const v = get(LAST[side]); return v && side !== "sundays" && v.startsWith(HOME[side]) ? v : HOME[side]; };

/** Which app a path belongs to. */
export const sideOf = (path: string): AppSide => (path.startsWith("/avl") ? "avl" : path.startsWith("/ops") ? "ops" : path.startsWith("/admin") ? "admin" : "sundays");

/** Remember where you are on this side. */
export function useRememberApp(side: AppSide, href: string) {
  useEffect(() => { set(LAST_APP, side); set(LAST[side], href); }, [side, href]);
}

/** `sundays`: include the Sundays tab (the Mac app); the website only has Operations and AVL. */
export function AppSwitcher({ side, sundays = true }: { side: AppSide; sundays?: boolean }) {
  const [hrefs, setHrefs] = useState(HOME);
  const { session } = useOpsSession();
  const me = useOpsMe(Boolean(session)).data;
  const nav = me?.status === "ok" ? me.nav : null;
  useEffect(() => {
    const s = get(LAST.sundays);
    setHrefs({ sundays: s && sideOf(s) === "sundays" ? s : HOME.sundays, ops: lastHref("ops"), avl: lastHref("avl"), admin: HOME.admin });
  }, [side]);
  // Signed out (or still checking): show both so the sign-in is reachable from either.
  const showOps = !nav || nav.ops || side === "ops";
  const showAvl = !nav || nav.avl || side === "avl";
  const tabs = [sundays && "sundays", showOps && "ops", showAvl && "avl"].filter(Boolean) as AppSide[];
  if (tabs.length < 2) return null;
  if (side === "admin" || me?.status === "no-org") return null;
  const meta: Record<AppSide, [string, React.ReactNode]> = {
    admin: ["Admin", null],
    sundays: ["Sundays", <Logo key="l" size={14} />], ops: ["Operations", <Building2 key="o" size={13} />], avl: ["AVL", <AudioLines key="a" size={13} />],
  };
  return (
    <div className="mx-3 mb-3 flex rounded-lg border border-line p-0.5">
      {tabs.map((key) => (
        <Link key={key} href={side === key ? "#" : hrefs[key]} onClick={(e) => side === key && e.preventDefault()}
          className={clsx("flex flex-1 items-center justify-center rounded-md font-medium transition",
            tabs.length > 2 ? "flex-col gap-0.5 py-1.5 text-[10.5px]" : "gap-1.5 py-1.5 text-xs",
            side === key ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-hover hover:text-ink-soft")}>
          {meta[key][1]}{meta[key][0]}
        </Link>
      ))}
    </div>
  );
}
