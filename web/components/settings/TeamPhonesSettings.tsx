"use client";
/**
 * Preferences → Network Connections → Team check-ins on phones: /leads (team leads see every team
 * and who's in) and /staff (the same, plus Check in), each with its own PIN, on the same network
 * address and port as the Kids & Nursery iPads, and optional friendly addresses.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ExternalLink, KeyRound, LogOut, Smartphone, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { TeamPhoneRole, TeamPhonesView } from "@shared/types";
import { Api } from "@/lib/api";
import { Spinner } from "@/components/ui";

const KEY = ["teamPhones"];
const LABEL: Record<TeamPhoneRole, string> = { leads: "Team leads", staff: "Staff" };
const WHAT: Record<TeamPhoneRole, string> = {
  leads: "See every ministry and team, with names and who has checked in.",
  staff: "Everything team leads see, plus a Check in button that checks someone in on every service that day they’re scheduled on, for each of their teams.",
};

export function TeamPhonesSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: Api.teamPhones, refetchInterval: (x) => (x.state.data?.enabled ? 5000 : false) });
  const save = useMutation({
    mutationFn: Api.saveTeamPhones,
    onSuccess: (v) => qc.setQueryData(KEY, v),
    onError: (e) => toast.error("Couldn’t save", { description: (e as Error).message }),
  });
  const [which, setWhich] = useState<TeamPhoneRole>("staff");
  if (!q.data) return <section id="team-phones" className="panel p-5"><Spinner /></section>;
  const v = q.data;
  const base = v.urls[0];
  const url = v.friendly[which] ?? (base ? `${base}/${which}` : null);
  return (
    <section id="team-phones" className="panel scroll-mt-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Smartphone size={16} /> Team check-ins on phones</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            The Team check-ins page for phones on the church Wi-Fi, and nothing else from Sundays. <b>Team leads</b> see every team and who’s in;
            <b> Staff</b> can also check people in. Each has its own PIN. Phones get names, photos and positions only, no contact details.
          </p>
        </div>
        <button role="switch" aria-checked={v.enabled} aria-label="Phone pages" onClick={() => save.mutate({ enabled: !v.enabled })}
          className={clsx("relative h-6 w-11 shrink-0 rounded-full transition", v.enabled ? "bg-ok" : "bg-line-strong")}>
          <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", v.enabled ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>

      <div className={clsx("mt-3 rounded-lg border px-3 py-2 text-xs",
        v.error ? "border-bad/30 bg-bad-soft text-bad" : v.enabled && v.running ? "border-ok/30 bg-ok-soft text-ok" : "border-line text-ink-muted")}>
        {v.error ?? (v.enabled && v.running ? <span className="inline-flex items-center gap-1.5"><Wifi size={12} /> On. Phones on this network can open the pages below.</span> : "Off. Turn it on to let phones open the pages.")}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(["leads", "staff"] as TeamPhoneRole[]).map((r) => <PinBox key={r} role={r} v={v} />)}
      </div>

      {v.enabled && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <div className="flex gap-1">
              {(["staff", "leads"] as TeamPhoneRole[]).map((r) => (
                <button key={r} onClick={() => setWhich(r)} className={clsx("rounded-md px-2.5 py-1 text-xs", which === r ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink-soft")}>{LABEL[r]}</button>
              ))}
            </div>
            <span className="label mt-3 block">Address for {LABEL[which].toLowerCase()}</span>
            <ul className="mt-1 space-y-1">
              {v.friendly[which] && <li className="select-all font-mono text-sm font-semibold text-accent">{v.friendly[which]}</li>}
              {v.urls.map((u) => <li key={u} className="select-all font-mono text-sm">{u}/{which}</li>)}
            </ul>
            <ol className="mt-3 list-decimal space-y-1 pl-4 text-[12px] text-ink-muted">
              <li>On the phone (on the church Wi-Fi), open the address or scan the code.</li>
              <li>Enter the {LABEL[which].toLowerCase()} PIN once. The phone stays signed in.</li>
              <li>Share → <b>Add to Home Screen</b> to open it like an app.</li>
            </ol>
            {base && <a className="btn-ghost mt-3 py-1 text-xs" href={`${base}/${which}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open it on this Mac</a>}
          </div>
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/paging/qr?url=${encodeURIComponent(url)}`} alt={`QR code for ${url}`} className="h-40 w-40 rounded-lg bg-white p-2" />
          )}
        </div>
      )}

      <Friendly v={v} onSave={(hostnames) => save.mutate({ hostnames })} />
      <p className="mt-3 text-[11px] text-ink-faint">
        Uses the same network port as the Kids &amp; Nursery iPads (Port, above) and your Planning Center access to read Services and Check-Ins.
        Planning Center’s Check-Ins can’t be written to by other apps, so staff check-ins are kept in Sundays on this Mac: they count on every
        Team check-ins screen, marked “by staff”, but don’t appear in Planning Center’s Check-Ins reports.
      </p>
    </section>
  );
}

function PinBox({ role, v }: { role: TeamPhoneRole; v: TeamPhonesView }) {
  const qc = useQueryClient();
  const [pin, setPin] = useState("");
  const setIt = useMutation({
    mutationFn: (p: string | null) => Api.setTeamPhonePin(role, p),
    onSuccess: (x, p) => { qc.setQueryData(KEY, x); setPin(""); toast.success(p ? `${LABEL[role]} PIN saved` : `${LABEL[role]} PIN removed`, { description: "Phones signed in to this page need the new PIN." }); },
    onError: (e) => toast.error("Couldn’t save the PIN", { description: (e as Error).message }),
  });
  const out = useMutation({ mutationFn: () => Api.signOutTeamPhones(role), onSuccess: () => toast.success(`Every ${LABEL[role].toLowerCase()} phone is signed out`) });
  const has = v.hasPin[role];
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center gap-2 text-sm font-medium"><KeyRound size={14} /> {LABEL[role]} <span className="font-mono text-xs text-ink-faint">/{role}</span></div>
      <p className="mt-0.5 text-[12px] text-ink-muted">{WHAT[role]}</p>
      <div className="mt-2 flex items-center gap-2">
        <input className="input w-28 py-1.5 font-mono text-sm" inputMode="numeric" maxLength={8} placeholder={has ? "New PIN" : "PIN"} value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        <button className="btn-primary py-1.5 text-xs" disabled={pin.length < 4 || setIt.isPending} onClick={() => setIt.mutate(pin)}>{has ? "Change" : "Set PIN"}</button>
        {has && <button className="btn-ghost p-1.5" title="Sign out every phone" onClick={() => out.mutate()}><LogOut size={14} /></button>}
      </div>
      {!has && <p className="mt-1.5 text-[11px] text-warn">Set a PIN (4 to 8 digits) before using this page.</p>}
    </div>
  );
}

function Friendly({ v, onSave }: { v: TeamPhonesView; onSave: (h: Partial<Record<TeamPhoneRole, string>>) => void }) {
  const [x, setX] = useState({ leads: v.hostnames.leads ?? "", staff: v.hostnames.staff ?? "" });
  useEffect(() => setX({ leads: v.hostnames.leads ?? "", staff: v.hostnames.staff ?? "" }), [v.hostnames.leads, v.hostnames.staff]);
  const commit = (r: TeamPhoneRole) => {
    const n = x[r].trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (n !== (v.hostnames[r] ?? "")) onSave({ ...v.hostnames, [r]: n });
  };
  return (
    <div className="mt-5 border-t border-line pt-4">
      <span className="label">Friendly addresses (optional)</span>
      <p className="mt-0.5 text-[12px] text-ink-muted">
        So people can just type <b>staff.yourchurch.org</b> or <b>leads.yourchurch.org</b>. Set them up like the iPad addresses: a DNS A record for each
        name pointing at this Mac’s fixed IP, and Port 80. Any address starting with <span className="font-mono">staff.</span> or <span className="font-mono">leads.</span> works even before it’s entered here.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {(["staff", "leads"] as TeamPhoneRole[]).map((r) => (
          <label key={r} className="block"><span className="text-[11px] text-ink-muted">{LABEL[r]}</span>
            <input className="input mt-0.5 font-mono text-sm" placeholder={`${r}.yourchurch.org`} value={x[r]}
              onChange={(e) => setX({ ...x, [r]: e.target.value })} onBlur={() => commit(r)} onKeyDown={(e) => e.key === "Enter" && commit(r)} />
          </label>
        ))}
      </div>
    </div>
  );
}
