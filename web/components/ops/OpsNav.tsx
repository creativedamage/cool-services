"use client";
/** Sidebar while in Church Ops. */
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Activity, Boxes, Building, Building2, ClipboardList, FileText, Inbox, LayoutGrid, LogOut, Plus, Search, Settings2, Tags, Users, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { opsSignOut, useOpsMe, useOpsSession } from "@/lib/ops";

type Item = { href: string; label: string; icon: typeof Inbox; badge?: number; tone?: "warn" | "accent" };

export function OpsNav() {
  const path = usePathname();
  const qc = useQueryClient();
  const { session } = useOpsSession();
  const me = useOpsMe(Boolean(session)).data;
  if (!me || me.status !== "ok") return <div className="flex-1" />;
  const n = me.nav;
  const groups: { title?: string; items: Item[] }[] = [
    { items: [
      { href: "/ops", label: "Overview", icon: LayoutGrid },
      { href: "/ops/requests/new", label: "New request", icon: Plus },
      { href: "/ops/requests", label: "My requests", icon: Inbox },
      ...(n.handlesRequests ? [{ href: "/ops/work", label: "Work queue", icon: ClipboardList, badge: n.queueCount, tone: "accent" as const }] : []),
    ] },
  ];
  if (n.avl) groups.push({ title: "AVL", items: [
    { href: "/ops/quotes", label: "Quotes", icon: FileText }, { href: "/ops/catalog", label: "Product pricing", icon: Search }, { href: "/ops/vendors", label: "Vendors", icon: Boxes },
  ] });
  if (n.manager) groups.push({ title: "Settings", items: [
    { href: "/ops/settings/users", label: "Users", icon: Users, badge: n.pendingUsers, tone: "warn" },
    { href: "/ops/settings/teams", label: "Teams", icon: UsersRound },
    { href: "/ops/settings/request-types", label: "Request types", icon: Tags },
    { href: "/ops/settings/campuses", label: "Campuses", icon: Building },
    { href: "/ops/settings/activity", label: "Activity", icon: Activity },
    ...(n.admin ? [{ href: "/ops/settings/organization", label: "Organization", icon: Settings2 }] : []),
  ] });
  const active = (href: string) => (href === "/ops" ? path === "/ops" : href === "/ops/requests" ? path === "/ops/requests" || path.startsWith("/ops/requests/view") : path.startsWith(href));
  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2">
        {groups.map((g, i) => (
          <div key={i}>
            {g.title && <div className="label px-2.5 pb-1.5">{g.title}</div>}
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition", active(it.href) ? "bg-violet-soft text-violet" : "text-ink-soft hover:bg-hover/60")}>
                  <it.icon size={14} /><span className="flex-1">{it.label}</span>
                  {!!it.badge && <span className={clsx("rounded-full px-1.5 text-[10px] font-semibold tabular-nums", it.tone === "warn" ? "bg-warn-soft text-warn" : "bg-violet-soft text-violet")}>{it.badge}</span>}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[11px] text-ink-muted">
        <span className="min-w-0 flex-1 truncate">Church Ops · {me.user.name}{n.campusName ? ` · ${n.campusName}` : ""}</span>
        <button className="rounded p-1 hover:bg-hover hover:text-ink" title="Sign out of Church Ops" onClick={async () => { await opsSignOut(); await qc.invalidateQueries({ queryKey: ["ops"] }); }}><LogOut size={12} /></button>
      </div>
    </div>
  );
}

/** Top of the sidebar in Church Ops: the church's own logo (Settings → Organization), or the Church Ops mark. */
export function OpsBrand({ fallback }: { fallback: string | null }) {
  const { session } = useOpsSession();
  const me = useOpsMe(Boolean(session)).data;
  const logo = me?.org.logoDark ?? null;
  const name = me?.org.name ?? fallback;
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      {logo ? <img src={logo} alt="" className="h-[30px] w-[30px] rounded-lg object-contain" />
        : <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-violet text-white"><Building2 size={16} /></span>}
      <div className="min-w-0 leading-tight">
        <div className="text-sm font-semibold">Church Ops</div>
        <div className="truncate text-[11px] text-ink-muted">{name ?? "\u00a0"}</div>
      </div>
    </div>
  );
}
