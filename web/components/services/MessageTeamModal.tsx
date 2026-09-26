"use client";
/**
 * Text (or email) one person, a team, or everyone on a service.
 *
 * Planning Center has no API for sending texts, so this works the way Planning Center's own mobile
 * app does: it opens a message in Messages on this Mac, already addressed with everyone's mobile
 * numbers from Planning Center and with your text filled in. With iPhone Text Message Forwarding
 * turned on, Messages sends SMS to non-iPhone numbers too.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Copy, Link2, Mail, MessageSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { PlanDetail, RosterStatus } from "@shared/types";
import { Api } from "@/lib/api";
import { clock } from "@/lib/format";
import { Avatar, Modal, Spinner } from "@/components/ui";

const STATUS_LABEL: Record<RosterStatus, string> = { C: "Confirmed", U: "Pending", D: "Declined" };

/** "(305) 555-0142" → "+13055550142" (US numbers without a country code get +1). */
export function smsNumber(raw: string) {
  const plus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (plus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

export function MessageTeamModal({ plan, preset, onClose }: {
  plan: PlanDetail;
  /** Start with these people (one person) or teams selected; nothing = everyone scheduled. */
  preset?: { personIds?: string[]; teamIds?: string[] };
  onClose: () => void;
}) {
  const people = useMemo(() => {
    const byPerson = new Map<string, { personId: string; name: string; avatarUrl: string | null; teams: Set<string>; positions: string[]; status: RosterStatus }>();
    for (const r of plan.roster) {
      const p = byPerson.get(r.personId) ?? { personId: r.personId, name: r.name, avatarUrl: r.avatarUrl, teams: new Set<string>(), positions: [], status: r.status };
      p.teams.add(r.teamId);
      p.positions.push(r.positionName);
      if (r.status === "C" || (r.status === "U" && p.status === "D")) p.status = r.status; // best status wins
      byPerson.set(r.personId, p);
    }
    return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [plan.roster]);
  const teams = useMemo(() => [...new Map(plan.roster.map((r) => [r.teamId, r.teamName])).entries()], [plan.roster]);

  const [statuses, setStatuses] = useState<Set<RosterStatus>>(new Set(preset?.personIds ? ["C", "U", "D"] : ["C", "U"]));
  const [teamSel, setTeamSel] = useState<Set<string>>(new Set(preset?.teamIds ?? []));
  const [picked, setPicked] = useState<Set<string> | null>(preset?.personIds ? new Set(preset.personIds) : null); // null = by filters
  const firstTime = plan.times.find((t) => t.kind === "rehearsal") ?? plan.times.find((t) => t.kind === "service");
  const [text, setText] = useState(() =>
    `Hi team! Reminder for ${plan.title} on ${new Date(plan.sortDate).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}${firstTime ? `, ${firstTime.kind === "rehearsal" ? "call time" : "service"} ${clock(firstTime.startsAt)}` : ""}.`);
  const [addLink, setAddLink] = useState(true);

  const inFilters = (p: (typeof people)[number]) => statuses.has(p.status) && (!teamSel.size || [...p.teams].some((t) => teamSel.has(t)));
  const chosen = people.filter((p) => (picked ? picked.has(p.personId) : inFilters(p)));

  const contacts = useQuery({
    queryKey: ["contacts", "msg", people.map((p) => p.personId).join(",")],
    queryFn: () => Api.contacts(people.map((p) => p.personId)),
    staleTime: 10 * 60_000,
  });
  const numberOf = (id: string) => { const c = contacts.data?.[id]; return c?.mobile ?? c?.phone ?? null; };
  const withNumber = chosen.filter((p) => numberOf(p.personId));
  const withEmail = chosen.filter((p) => contacts.data?.[p.personId]?.email);
  const noNumber = chosen.filter((p) => contacts.data && !numberOf(p.personId));

  const link = `https://services.planningcenteronline.com/plans/${plan.id}`;
  const body = addLink ? `${text}\n${link}` : text;

  const openMessages = () => {
    const nums = [...new Set(withNumber.map((p) => smsNumber(numberOf(p.personId)!)))];
    if (!nums.length) return toast.error("No mobile numbers for the people selected");
    window.location.href = `sms://open?addresses=${nums.join(",")}&body=${encodeURIComponent(body)}`;
    toast.success(`Opening Messages for ${nums.length} ${nums.length === 1 ? "person" : "people"}`, { description: "Check the message, then press Send in Messages." });
  };
  const openMail = () => {
    const emails = [...new Set(withEmail.map((p) => contacts.data![p.personId].email!))];
    if (!emails.length) return toast.error("No email addresses for the people selected");
    const to = emails.length === 1 ? emails[0] : "";
    window.location.href = `mailto:${to}?${emails.length > 1 ? `bcc=${emails.join(",")}&` : ""}subject=${encodeURIComponent(`${plan.title} · ${new Date(plan.sortDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`)}&body=${encodeURIComponent(body)}`;
  };
  const copyNumbers = async () => {
    await navigator.clipboard.writeText(withNumber.map((p) => smsNumber(numberOf(p.personId)!)).join(", "));
    toast.success("Numbers copied");
  };

  const togglePerson = (id: string) => {
    const base = picked ?? new Set(chosen.map((p) => p.personId));
    const next = new Set(base);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  return (
    <Modal open onClose={onClose} width={780} title={<span className="flex items-center gap-2"><MessageSquare size={16} className="text-accent" /> Message the team</span>}>
      <div className="grid max-h-[72vh] gap-5 overflow-y-auto p-5 md:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <span className="label">Message</span>
          <textarea className="input mt-1 h-36 resize-none text-sm leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} />
          <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" checked={addLink} onChange={(e) => setAddLink(e.target.checked)} />
            <Link2 size={12} /> Add a link to the plan in Planning Center
          </label>
          <div className="mt-1 text-[11px] text-ink-faint">{text.length + (addLink ? link.length + 1 : 0)} characters</div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!withNumber.length || contacts.isLoading} onClick={openMessages}>
              {contacts.isLoading ? <Spinner /> : <MessageSquare size={14} />} Text {withNumber.length} in Messages
            </button>
            <button className="btn-outline" disabled={!withEmail.length} onClick={openMail}><Mail size={14} /> Email {withEmail.length}</button>
            <button className="btn-ghost" disabled={!withNumber.length} onClick={copyNumbers}><Copy size={14} /> Copy numbers</button>
          </div>
          {noNumber.length > 0 && (
            <p className="mt-3 text-xs text-warn">No phone number in Planning Center for {noNumber.map((p) => p.name).join(", ")}.</p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            Opens a new message in Messages on this Mac, addressed to everyone selected, for you to check and send, the same way
            Planning Center’s mobile app sends team texts. For people without an iPhone, turn on Text Message Forwarding on your
            iPhone (Settings → Messages). Planning Center doesn’t offer a way for apps to send texts directly.
          </p>
        </div>

        <div className="min-w-0">
          <span className="label">Who</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {(["C", "U", "D"] as RosterStatus[]).map((s) => (
              <button key={s} onClick={() => { setPicked(null); setStatuses((x) => { const n = new Set(x); if (n.has(s)) n.delete(s); else n.add(s); return n; }); }}
                className={clsx("rounded-full border px-2.5 py-0.5 text-[11px]", statuses.has(s) && !picked ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-ink-muted")}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          {teams.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <button onClick={() => { setPicked(null); setTeamSel(new Set()); }}
                className={clsx("rounded-full border px-2.5 py-0.5 text-[11px]", !teamSel.size && !picked ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-ink-muted")}>All teams</button>
              {teams.map(([id, name]) => (
                <button key={id} onClick={() => { setPicked(null); setTeamSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }}
                  className={clsx("rounded-full border px-2.5 py-0.5 text-[11px]", teamSel.has(id) && !picked ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-ink-muted")}>{name}</button>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between text-[11px] text-ink-muted">
            <span>{chosen.length} selected</span>
            {picked && <button className="text-accent hover:underline" onClick={() => setPicked(null)}>Use the filters</button>}
          </div>
          <ul className="mt-1 max-h-[44vh] space-y-0.5 overflow-y-auto rounded-lg border border-line p-1">
            {people.map((p) => {
              const on = picked ? picked.has(p.personId) : inFilters(p);
              const num = numberOf(p.personId);
              return (
                <li key={p.personId}>
                  <label className={clsx("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm", on ? "bg-hover/60" : "opacity-60")}>
                    <input type="checkbox" checked={on} onChange={() => togglePerson(p.personId)} />
                    <Avatar name={p.name} src={p.avatarUrl} size={22} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{p.name}</span>
                      <span className="block truncate text-[10px] text-ink-faint">{p.positions.join(", ")} · {STATUS_LABEL[p.status]}{contacts.data && !num ? " · no number" : ""}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
