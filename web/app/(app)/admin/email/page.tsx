"use client";
/**
 * Sundays' email relay: the one email service (Brevo or Resend) every organization can send
 * through without setting up its own. Organizations can still use their own account in their
 * settings.
 */
import { Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Loading, PageHeader, Pill } from "@/components/ops/OpsUi";
import { MailLog, SenderFields, senderJson, type MailLogRow, type SenderForm } from "@/components/EmailSetup";
import { Spinner } from "@/components/ui";

interface Data { provider: "brevo" | "resend"; hasKey: boolean; fromEmail: string | null; fromName: string | null; updatedBy: string | null; today: number; recent: MailLogRow[] }

export default function AdminEmail() {
  const d = useOps<Data>("/platform/email");
  if (!d.data) return <><PageHeader crumb="Sundays admin" title="Email" /><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  return <Relay key={JSON.stringify({ ...d.data, recent: null, today: null })} data={d.data} />;
}

function Relay({ data }: { data: Data }) {
  const refresh = useOpsRefresh();
  const [f, setF] = useState<SenderForm>({ provider: data.provider, fromEmail: data.fromEmail, fromName: data.fromName, replyTo: null });
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const save = async () => { const { replyTo: _r, ...j } = senderJson(f); await ops("/platform/email", { method: "PUT", json: j }); };
  const ready = data.hasKey && Boolean(data.fromEmail);
  return (
    <>
      <PageHeader crumb="Sundays admin" title="Email" description="Sundays’ email relay. Every organization sends its request emails through it unless it sets up its own account." />
      <div className="space-y-5">
        <Card eyebrow="Sundays’ relay" title={<span className="flex items-center gap-2">Email service {ready ? <Pill tone="ok">on</Pill> : <Pill tone="warn">not set up</Pill>}</span>}
          action={<div className="flex gap-2">
            <button className="btn-outline" disabled={busy !== null} onClick={async () => {
              setBusy("test");
              try { await save(); const r = await ops<{ to: string }>("/platform/email/test", { method: "POST" }); toast.success(`Test sent to ${r.to}`); } catch (e) { toast.error((e as Error).message, { duration: 10000 }); } finally { setBusy(null); await refresh(); }
            }}>{busy === "test" ? <Spinner /> : <Send size={14} />} Send me a test</button>
            <button className="btn-primary" disabled={busy !== null} onClick={async () => {
              setBusy("save"); try { await save(); toast.success("Saved"); await refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
            }}>{busy === "save" && <Spinner />}Save</button>
          </div>}>
          <div className="space-y-3 p-4">
            <SenderFields value={f} onChange={setF} hasKey={data.hasKey} relayAvailable choices={["brevo", "resend"]} name="Sundays" />
            <p className="text-[11px] text-ink-faint">
              Each email shows the organization’s name and its reply-to address; the sending address is this one. Up to 300 a day per organization go through the relay.
              {data.updatedBy ? ` Last changed by ${data.updatedBy}.` : ""} Sent in the last 24 hours: {data.today}.
            </p>
          </div>
        </Card>
        <Card eyebrow="Everyone" title="Recently sent"><MailLog rows={data.recent} showWho /></Card>
      </div>
    </>
  );
}
