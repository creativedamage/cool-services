"use client";
/** Which organization you're working in, and switching between them (Slack-style). */
import clsx from "clsx";
import { Check, ChevronsUpDown, Plus, ShieldHalf } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { OpsMe } from "@shared/ops/types";
import { useOpsMe, useOpsSession, useSwitchOrg } from "@/lib/ops";
import { Modal } from "@/components/ui";
import { CreateOrgForm } from "./Plans";

/** The organizations someone belongs to, as a pick list. */
export function OrgList({ me, onPick }: { me: OpsMe; onPick?: () => void }) {
  const switchOrg = useSwitchOrg();
  const current = "org" in me ? me.org.id : null;
  return (
    <ul className="space-y-0.5">
      {me.orgs.filter((o) => !o.support || o.id === current).map((o) => (
        <li key={o.id}>
          <button onClick={() => { onPick?.(); void switchOrg(o.id); }}
            className={clsx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover", o.id === current && "text-accent")}>
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-hover text-[10px] font-semibold uppercase text-ink-soft">{o.name.slice(0, 2)}</span>
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            {o.memberStatus !== "active" && <span className="text-[10px] text-warn">{o.memberStatus}</span>}
            {o.status === "SUSPENDED" && <span className="text-[10px] text-bad">paused</span>}
            {o.id === current && <Check size={13} />}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Under the app's name in the sidebar: the current organization, with a menu to switch. */
export function OrgSwitcher() {
  const { session } = useOpsSession();
  const me = useOpsMe(Boolean(session)).data;
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!me || me.status === "no-org" || !("org" in me)) return null;
  const many = me.orgs.filter((o) => !o.support).length > 1 || me.platform;
  return (
    <div ref={ref} className="relative mx-3 mb-3">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-left text-xs hover:border-line-strong">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{me.org.name ?? "Your organization"}</span>
          {me.org.status === "TRIAL" && me.org.trialEndsAt && <span className="block text-[10px] text-ink-faint">Trial until {new Date(me.org.trialEndsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
        </span>
        <ChevronsUpDown size={13} className="shrink-0 text-ink-faint" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 rounded-lg border border-line bg-raised p-1.5 shadow-lift">
          <div className="label px-2 pb-1 pt-0.5">Organizations</div>
          <OrgList me={me} onPick={() => setOpen(false)} />
          <div className="my-1 border-t border-line" />
          <button onClick={() => { setOpen(false); setCreating(true); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-soft hover:bg-hover"><Plus size={14} /> New organization</button>
          {me.platform && <Link href="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-soft hover:bg-hover"><ShieldHalf size={14} /> Sundays admin console</Link>}
          {!many && <p className="px-2 pb-1 pt-1 text-[10px] text-ink-faint">Belong to more than one? They show up here.</p>}
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New organization" width={760}>
        <div className="p-5">{creating && <CreateOrgForm onCreated={() => { setCreating(false); window.location.assign("/ops"); }} onCancel={() => setCreating(false)} />}</div>
      </Modal>
    </div>
  );
}
