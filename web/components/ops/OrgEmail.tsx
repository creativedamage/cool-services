"use client";
/** Settings → Organization → Email: who sends Operations' emails, and which ones go out. */
import { Mail, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Check, ErrorBox, Loading } from "@/components/ops/OpsUi";
import { MailLog, SenderFields, senderJson, type MailLogRow, type SenderForm } from "@/components/EmailSetup";
import { Spinner } from "@/components/ui";

interface Data extends SenderForm {
  hasKey: boolean; relay: { available: boolean };
  notifyTeam: boolean; notifyApprovers: boolean; notifyAssignee: boolean; notifyRequester: boolean;
  recent: MailLogRow[];
}

export function OrgEmail({ orgName }: { orgName: string }) {
  const d = useOps<Data>("/settings/email");
  if (!d.data) return <Card eyebrow="Email" title="Request emails"><ErrorBox error={d.error} />{!d.error && <Loading />}</Card>;
  return <Form key={JSON.stringify({ ...d.data, recent: null })} data={d.data} orgName={orgName} />;
}

function Form({ data, orgName }: { data: Data; orgName: string }) {
  const refresh = useOpsRefresh();
  const [f, setF] = useState<Data>(data);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const save = async () => {
    await ops("/settings/email", { method: "PUT", json: { ...senderJson(f), notifyTeam: f.notifyTeam, notifyApprovers: f.notifyApprovers, notifyAssignee: f.notifyAssignee, notifyRequester: f.notifyRequester } });
  };
  return (
    <Card eyebrow="Email" title={<span className="flex items-center gap-2"><Mail size={15} /> Request emails</span>}
      action={<div className="flex gap-2">
        <button type="button" className="btn-outline" disabled={busy !== null || f.provider === "off"} title="Saves, then sends a test to you"
          onClick={async () => {
            setBusy("test");
            try { await save(); const r = await ops<{ to: string }>("/settings/email/test", { method: "POST" }); toast.success(`Test sent to ${r.to}`); } catch (e) { toast.error((e as Error).message, { duration: 10000 }); } finally { setBusy(null); await refresh(); }
          }}>{busy === "test" ? <Spinner /> : <Send size={14} />} Send me a test</button>
        <button type="button" className="btn-primary" disabled={busy !== null}
          onClick={async () => { setBusy("save"); try { await save(); toast.success("Saved"); await refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); } }}>
          {busy === "save" && <Spinner />}Save</button>
      </div>}>
      <div className="grid gap-6 p-4 lg:grid-cols-[1.4fr_1fr]">
        <SenderFields value={f} onChange={(v) => setF({ ...f, ...v })} hasKey={data.hasKey} relayAvailable={data.relay.available} name={orgName}
          replyHint="When someone replies to a request email, it goes here." />
        <div className="space-y-3">
          <span className="label block">Send these</span>
          <Check label="New work orders and supply requests" hint="To the team that handles them." checked={f.notifyTeam} onChange={(v) => setF({ ...f, notifyTeam: v })} />
          <Check label="Waiting for approval" hint="To the team that approves them." checked={f.notifyApprovers} onChange={(v) => setF({ ...f, notifyApprovers: v })} />
          <Check label="Assigned to you" hint="To the person it’s assigned to." checked={f.notifyAssignee} onChange={(v) => setF({ ...f, notifyAssignee: v })} />
          <Check label="Updates for whoever asked" hint="Approved, declined (with the reason), on hold, ordered and done." checked={f.notifyRequester} onChange={(v) => setF({ ...f, notifyRequester: v })} />
          <p className="text-[11px] text-ink-faint">Nobody gets an email about something they did themselves.</p>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="label px-4 pt-3">Recently sent</div>
        <MailLog rows={data.recent} />
      </div>
    </Card>
  );
}
