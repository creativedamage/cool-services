"use client";
/**
 * Who gets which workflow.
 *  - Everyone sees the workflows assigned or shared to them. The rest are locked, with Request access.
 *  - A workflow's managers (and People managers / site administrators) approve requests here, which
 *    shares the workflow with that person in Planning Center, and can share it with anyone directly.
 *  - New cards on your workflows pop up as notifications.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Lock, Mail, Search, Send, Share2, Trash2, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Person, WorkflowAccessRequest, WorkflowShareGroup, WorkflowSummary } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { routes } from "@/lib/routes";
import { Avatar, Modal, Spinner } from "@/components/ui";

export const GROUPS: { value: WorkflowShareGroup; hint: string }[] = [
  { value: "Viewer", hint: "See cards" },
  { value: "Editor", hint: "Work cards" },
  { value: "Manager", hint: "Work cards and share" },
];
export const requestsKey = ["workflowRequests"] as const;
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

/** Share a workflow: the people it's shared with, adding someone, and requests waiting on it. */
export function ShareModal({ workflow, onClose }: { workflow: { id: string; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ["workflowShares", workflow.id];
  const shares = useQuery({ queryKey: key, queryFn: () => Api.workflowShares(workflow.id) });
  const requests = useQuery({ queryKey: requestsKey, queryFn: Api.workflowRequests });
  const waiting = (requests.data?.toReview ?? []).filter((r) => r.workflowId === workflow.id);
  const after = (list: unknown) => { qc.setQueryData(key, list); void qc.invalidateQueries({ queryKey: qk.workflows }); };
  const set = useMutation({
    mutationFn: (v: { personId: string; group: WorkflowShareGroup }) => Api.shareWorkflow(workflow.id, v.personId, v.group),
    onSuccess: (l) => { after(l); toast.success("Shared in Planning Center"); },
    onError: (e) => toast.error("Couldn’t share it", { description: (e as Error).message }),
  });
  const remove = useMutation({
    mutationFn: (shareId: string) => Api.unshareWorkflow(workflow.id, shareId),
    onSuccess: after,
    onError: (e) => toast.error("Couldn’t remove them", { description: (e as Error).message }),
  });
  const [group, setGroup] = useState<WorkflowShareGroup>("Editor");

  return (
    <Modal open onClose={onClose} width={600} title={<span className="flex items-center gap-2"><Share2 size={16} /> Share · {workflow.name}</span>}>
      <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
        {waiting.length > 0 && (
          <section>
            <h3 className="label mb-2">Asking for access</h3>
            <div className="space-y-2">{waiting.map((r) => <RequestRow key={r.id} r={r} showWorkflow={false} />)}</div>
          </section>
        )}
        <section>
          <h3 className="label mb-2">Add someone</h3>
          <div className="flex items-center gap-2">
            <PersonPicker onPick={(p) => set.mutate({ personId: p.id, group })} busy={set.isPending} />
            <select className="input w-40 py-1.5 text-sm" value={group} onChange={(e) => setGroup(e.target.value as WorkflowShareGroup)}>
              {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.value} · {g.hint}</option>)}
            </select>
          </div>
        </section>
        <section>
          <h3 className="label mb-2">Shared with</h3>
          {shares.isLoading ? <Spinner /> : shares.error ? <p className="text-sm text-bad">{(shares.error as Error).message}</p> : (
            <ul className="divide-y divide-line/60 rounded-lg border border-line">
              {(shares.data ?? []).filter((s) => s.group !== "No Access").map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar name={s.name || "?"} src={s.avatarUrl} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm">{s.name || `Person ${s.personId}`}</span>
                  <select className="input w-32 py-1 text-xs" value={s.group} onChange={(e) => set.mutate({ personId: s.personId, group: e.target.value as WorkflowShareGroup })}>
                    {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.value}</option>)}
                  </select>
                  <button className="btn-ghost p-1.5 hover:text-bad" title="Stop sharing" onClick={() => remove.mutate(s.id)}><Trash2 size={14} /></button>
                </li>
              ))}
              {!shares.data?.some((s) => s.group !== "No Access") && <li className="px-3 py-3 text-sm text-ink-muted">Not shared with anyone by name yet.</li>}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-ink-faint">This is the workflow’s sharing in Planning Center, so it applies everywhere (Planning Center and every copy of Sundays).</p>
        </section>
      </div>
    </Modal>
  );
}

function PersonPicker({ onPick, busy }: { onPick: (p: Person) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [deb, setDeb] = useState("");
  useEffect(() => { const t = setTimeout(() => setDeb(q), 250); return () => clearTimeout(t); }, [q]);
  const hits = useQuery({ queryKey: ["peopleSearch", deb], queryFn: () => Api.searchPeople(deb), enabled: deb.trim().length >= 2 });
  return (
    <div className="relative flex-1">
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
      <input className="input py-1.5 pl-8 text-sm" placeholder="Find a person…" value={q} onChange={(e) => setQ(e.target.value)} />
      {busy && <span className="absolute right-2.5 top-1/2 -translate-y-1/2"><Spinner size={12} /></span>}
      {deb.trim().length >= 2 && q && (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-raised shadow-xl">
          {hits.isLoading && <li className="px-3 py-2"><Spinner size={12} /></li>}
          {hits.data?.map((p) => (
            <li key={p.id}>
              <button className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-hover" onClick={() => { onPick(p); setQ(""); }}>
                <Avatar name={p.name} src={p.avatarUrl} size={24} /> {p.name} <UserPlus size={13} className="ml-auto text-ink-faint" />
              </button>
            </li>
          ))}
          {hits.data && !hits.data.length && <li className="px-3 py-2 text-sm text-ink-muted">Nobody by that name.</li>}
        </ul>
      )}
    </div>
  );
}

/** One request, with Approve (as Viewer / Editor / Manager) and Deny. */
export function RequestRow({ r, showWorkflow = true }: { r: WorkflowAccessRequest; showWorkflow?: boolean }) {
  const qc = useQueryClient();
  const [group, setGroup] = useState<WorkflowShareGroup>("Editor");
  const decide = useMutation({
    mutationFn: (d: "approve" | "deny") => Api.decideWorkflowRequest(r.id, d, group),
    onSuccess: (x) => {
      toast.success(x.state === "approved" ? `${r.personName} can now use ${r.workflowName}` : "Request declined");
      void qc.invalidateQueries({ queryKey: requestsKey });
      void qc.invalidateQueries({ queryKey: ["workflowShares", r.workflowId] });
      void qc.invalidateQueries({ queryKey: qk.workflows });
    },
    onError: (e) => toast.error("Couldn’t do that", { description: (e as Error).message }),
  });
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2">
      <Avatar name={r.personName} src={r.avatarUrl} size={30} />
      <div className="min-w-0 flex-1 text-sm">
        <div><b>{r.personName}</b> asked for {showWorkflow ? <b>{r.workflowName}</b> : "access"} <span className="text-xs text-ink-muted">· {ago(r.requestedAt)}</span></div>
        {r.note && <div className="truncate text-xs text-ink-muted">“{r.note}”</div>}
      </div>
      <select className="input w-28 py-1 text-xs" value={group} onChange={(e) => setGroup(e.target.value as WorkflowShareGroup)} title="What they can do">
        {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.value}</option>)}
      </select>
      <button className="btn-primary py-1 text-xs" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>{decide.isPending ? <Spinner size={12} /> : <Check size={13} />} Approve</button>
      <button className="btn-ghost py-1 text-xs hover:text-bad" disabled={decide.isPending} onClick={() => decide.mutate("deny")}><X size={13} /> Deny</button>
    </div>
  );
}

/** Ask for a workflow you aren't on. */
export function RequestAccessModal({ workflow, onClose }: { workflow: { id: string; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const me = useQuery({ queryKey: qk.me, queryFn: Api.me, staleTime: Infinity });
  const ask = useMutation({
    mutationFn: () => Api.requestWorkflow(workflow.id, note.trim() || undefined),
    onSuccess: () => { setSent(true); void qc.invalidateQueries({ queryKey: requestsKey }); },
    onError: (e) => toast.error("Couldn’t send the request", { description: (e as Error).message }),
  });
  const mail = `mailto:?subject=${encodeURIComponent(`Access to ${workflow.name}`)}&body=${encodeURIComponent(
    `Hi,\n\nCould you give me access to the “${workflow.name}” workflow? In Sundays: Workflows → ${workflow.name} → Share, then add ${me.data?.name ?? "me"}.${note.trim() ? `\n\n${note.trim()}` : ""}\n\nThanks!`)}`;
  return (
    <Modal open onClose={onClose} width={520} title={<span className="flex items-center gap-2"><Lock size={15} /> {workflow.name}</span>}>
      <div className="space-y-4 p-5 text-sm">
        {!sent ? (
          <>
            <p className="text-ink-soft">This workflow isn’t assigned or shared to you. Ask for access and one of its managers can approve it in Sundays.</p>
            <textarea className="input min-h-[80px]" placeholder="Anything they should know? (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 font-medium text-ok"><Check size={16} /> Request sent</p>
            <p className="text-ink-soft">Its managers see it under <b>Workflows → Access requests</b> the next time they open Sundays on this Mac. Once they approve it, {workflow.name} shows up under My workflows.</p>
            <p className="text-xs text-ink-muted">If they use Sundays on a different computer, send them a quick email as well. They can add you from the workflow’s Share button.</p>
          </>
        )}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        {sent ? (
          <>
            <a className="btn-ghost" href={mail}><Mail size={14} /> Email a manager</a>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={ask.isPending} onClick={() => ask.mutate()}>{ask.isPending ? <Spinner /> : <Send size={14} />} Request access</button>
          </>
        )}
      </footer>
    </Modal>
  );
}

/** Shown instead of a board you can't open. */
export function LockedWorkflow({ workflow }: { workflow: WorkflowSummary }) {
  const [asking, setAsking] = useState(false);
  const requests = useQuery({ queryKey: requestsKey, queryFn: Api.workflowRequests });
  const pending = requests.data?.mine.find((r) => r.workflowId === workflow.id && r.state === "pending");
  return (
    <div className="m-auto max-w-md p-8 text-center">
      <Lock size={28} className="mx-auto text-ink-faint" />
      <h1 className="mt-3 text-lg font-semibold">{workflow.name}</h1>
      <p className="mt-1 text-sm text-ink-muted">This workflow isn’t assigned or shared to you.</p>
      {pending
        ? <p className="mt-4 text-sm text-accent">You asked for access {ago(pending.requestedAt)}. It’ll open here once a manager approves it.</p>
        : <button className="btn-primary mt-4" onClick={() => setAsking(true)}><Send size={14} /> Request access</button>}
      {asking && <RequestAccessModal workflow={workflow} onClose={() => setAsking(false)} />}
    </div>
  );
}

/**
 * Background watcher (in the app layout): a notification when a card lands on one of your
 * workflows, when someone asks for a workflow you manage, and when your own request is answered.
 */
export function WorkflowWatcher() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: qk.me, queryFn: Api.me, staleTime: Infinity });
  const workflows = useQuery({ queryKey: qk.workflows, queryFn: Api.workflows, refetchInterval: 60_000 });
  const requests = useQuery({ queryKey: requestsKey, queryFn: Api.workflowRequests, refetchInterval: 60_000 });
  const busy = useRef(false);
  const who = me.data?.id ?? "";
  const store = (k: string) => `coolservices.seen.${who}.${k}`;
  const read = (k: string): string[] | null => { try { const v = localStorage.getItem(store(k)); return v ? JSON.parse(v) : null; } catch { return null; } };
  const write = (k: string, v: string[]) => { try { localStorage.setItem(store(k), JSON.stringify(v.slice(-500))); } catch { /* private window */ } };

  // New cards on my workflows.
  useEffect(() => {
    if (!who || !workflows.data || busy.current) return;
    busy.current = true;
    const mine = workflows.data.filter((w) => w.mine);
    void (async () => {
      for (const w of mine) {
        try {
          const b = await qc.fetchQuery({ queryKey: qk.board(w.id), queryFn: () => Api.board(w.id), staleTime: 45_000 });
          const ids = b.cards.map((c) => c.id);
          const seen = read(`wf.${w.id}`);
          write(`wf.${w.id}`, [...new Set([...(seen ?? []), ...ids])]);
          if (!seen) continue; // first look: remember what's there, no notifications
          const fresh = b.cards.filter((c) => !seen.includes(c.id));
          if (!fresh.length) continue;
          const step = (id: string | null) => b.steps.find((s) => s.id === id)?.name ?? "";
          toast(fresh.length === 1 ? `New in ${w.name}` : `${fresh.length} new in ${w.name}`, {
            description: fresh.length === 1 ? `${fresh[0].person.name}${step(fresh[0].stepId) ? ` · ${step(fresh[0].stepId)}` : ""}` : fresh.slice(0, 3).map((c) => c.person.name).join(", ") + (fresh.length > 3 ? "…" : ""),
            action: { label: "Open", onClick: () => router.push(routes.board(w.id)) },
            duration: 10_000,
          });
        } catch { /* try again next minute */ }
      }
      busy.current = false;
    })();
  }, [workflows.dataUpdatedAt, who]); // eslint-disable-line react-hooks/exhaustive-deps

  // Access requests: new ones for me to answer, and answers to mine.
  useEffect(() => {
    if (!who || !requests.data) return;
    const seen = read("requests");
    const keys = [...requests.data.toReview.map((r) => `in:${r.id}`), ...requests.data.mine.filter((r) => r.state !== "pending").map((r) => `out:${r.id}:${r.state}`)];
    write("requests", [...new Set([...(seen ?? []), ...keys])]);
    if (!seen) return;
    for (const r of requests.data.toReview) {
      if (seen.includes(`in:${r.id}`)) continue;
      toast(`${r.personName} asked for ${r.workflowName}`, { description: r.note ?? "Approve or deny it in Workflows.", action: { label: "Review", onClick: () => router.push("/workflows") }, duration: 15_000 });
    }
    for (const r of requests.data.mine) {
      if (r.state === "pending" || seen.includes(`out:${r.id}:${r.state}`)) continue;
      if (r.state === "approved") toast.success(`You now have ${r.workflowName}`, { description: r.decidedBy ? `Approved by ${r.decidedBy}` : undefined, action: { label: "Open", onClick: () => router.push(routes.board(r.workflowId)) } });
      else toast(`Your request for ${r.workflowName} was declined`, { description: r.decidedBy ? `By ${r.decidedBy}` : undefined });
      void qc.invalidateQueries({ queryKey: qk.workflows });
    }
  }, [requests.dataUpdatedAt, who]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

