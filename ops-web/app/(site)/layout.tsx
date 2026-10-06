"use client";
/**
 * The website's frame: the Operations or AVL sidebar (a slide-out menu on phones), and a switcher
 * between the two for people who have both.
 */
import clsx from "clsx";
import { Menu, Moon, Sun, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppSwitcher, sideOf, useRememberApp } from "@/components/AppSwitcher";
import { AdminBrand, AdminNav, AvlBrand, AvlNav, OpsBrand, OpsNav } from "@/components/ops/OpsNav";
import { OrgSwitcher } from "@/components/ops/OrgSwitcher";
import { currentTheme, setTheme } from "@/lib/theme";
import { ElsewherePage, isSingle, useCurrentApp } from "@/components/AppLinks";
import { appHas } from "@shared/apps";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <Suspense><Shell>{children}</Shell></Suspense>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const qs = useSearchParams().toString();
  const s0 = sideOf(path);
  const side = s0 === "avl" || s0 === "admin" ? s0 : "ops";
  useRememberApp(side, qs ? `${path}?${qs}` : path);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path, qs]);
  // The Sundays Operations / Sundays AVL Mac apps: only their own screens.
  const cur = useCurrentApp();
  const elsewhere = isSingle(cur) && !appHas(cur, path);
  const brand = side === "admin" ? <AdminBrand /> : side === "avl" ? <AvlBrand /> : <OpsBrand fallback={null} />;
  return (
    <div className={clsx("flex h-[100dvh] flex-col overflow-hidden md:flex-row", side === "ops" ? "app-ops" : side === "avl" ? "app-avl" : "app-admin")}>
      {/* Phones: a top bar with a menu button. */}
      <header className="flex items-center justify-between border-b border-line bg-surface/80 pr-2 backdrop-blur md:hidden">
        {brand}
        <button className="btn-ghost p-2" aria-label="Menu" onClick={() => setOpen(true)}><Menu size={20} /></button>
      </header>
      {open && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}
      <aside className={clsx(
        "fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-line bg-surface transition-transform md:static md:z-auto md:w-[240px] md:translate-x-0 md:bg-gradient-to-b md:from-accent/10 md:to-surface/60",
        open ? "translate-x-0 shadow-2xl" : "-translate-x-full",
      )}>
        <div className="flex items-center justify-between">
          {brand}
          <button className="btn-ghost mr-2 p-2 md:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        <AppSwitcher side={side} sundays={false} />
        {side !== "admin" && <OrgSwitcher />}
        {side === "admin" ? <AdminNav /> : side === "avl" ? <AvlNav /> : <OpsNav />}
        <ThemeToggle />
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{elsewhere && isSingle(cur) ? <ElsewherePage current={cur} target={s0 === "avl" ? "avl" : "ops"} page={qs ? `${path}?${qs}` : path} /> : children}</main>
    </div>
  );
}

function ThemeToggle() {
  const [t, setT] = useState<"dark" | "light">("dark");
  useEffect(() => setT(currentTheme()), []);
  return (
    <button className="mx-2 mb-3 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-ink-muted hover:bg-hover hover:text-ink"
      onClick={() => setT(setTheme(t === "dark" ? "light" : "dark"))}>
      {t === "dark" ? <Sun size={12} /> : <Moon size={12} />} {t === "dark" ? "Light" : "Dark"} mode
    </button>
  );
}
