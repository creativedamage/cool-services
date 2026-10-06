"use client";
/** The church's plan, branding, details and emails (System admins). AVL has its own under AVL → Business. */
import { useState } from "react";
import { toast } from "sonner";
import type { OrgSettings } from "@shared/ops/types";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, ErrorBox, Field, Loading, PageHeader } from "@/components/ops/OpsUi";
import { LogoPicker } from "@/components/ops/LogoPicker";
import { PlanBilling } from "@/components/ops/PlanBilling";
import { useModule } from "@/components/ops/context";
import { OrgEmail } from "@/components/ops/OrgEmail";

type Data = { org: OrgSettings; logo: string | null; logoDark: string | null };
const TEXT: [keyof OrgSettings, string][] = [
  ["name", "Name"], ["legalName", "Legal name"], ["addressLine1", "Address"], ["addressLine2", "Address line 2"], ["city", "City"], ["state", "State"],
  ["postalCode", "ZIP"], ["phone", "Phone"], ["email", "Email"], ["website", "Website"], ["ein", "EIN (Federal Tax ID)"], ["salesTaxId", "Sales tax / exemption #"],
  ["quotePrefix", "Request number prefix"],
];

export default function Organization() {
  const d = useOps<Data>("/settings/organization");
  if (!d.data) return <><PageHeader crumb="Settings" title="Organization" /><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  return <OrgForm key={JSON.stringify(d.data.org)} data={d.data} />;
}

function OrgForm({ data }: { data: Data }) {
  const branded = useModule("branding");
  const refresh = useOpsRefresh();
  const [o, setO] = useState<OrgSettings>(data.org);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const json = Object.fromEntries(TEXT.map(([k]) => [k, o[k]]));
    try { await ops("/settings/organization", { method: "PUT", json }); toast.success("Saved"); await refresh(); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  const upload = (variant: "light" | "dark") => (mime: string, dataB64: string) => ops("/settings/organization/logo", { json: { variant, mime, dataB64 } });
  const remove = (variant: "light" | "dark") => () => ops(`/settings/organization/logo/${variant}`, { method: "DELETE" });
  return (
    <>
      <PageHeader crumb="Settings" title="Organization & billing" description="Your plan, what you pay, your organization's details and its emails." />
      <div className="space-y-5">
        <PlanBilling />
        {!branded ? (
          <Card eyebrow="Branding" title="Logo"><p className="p-4 text-sm text-ink-muted">Your logo in the app and on printouts comes with the Custom branding module.</p></Card>
        ) : <Card eyebrow="Branding" title="Logo">
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <LogoPicker current={data.logo} label="For light backgrounds (printouts)" upload={upload("light")} remove={remove("light")} />
            <LogoPicker dark current={data.logoDark} label="For dark backgrounds (Sundays)" upload={upload("dark")} remove={remove("dark")} />
          </div>
        </Card>}
        <form onSubmit={save}>
          <Card eyebrow="Organization" title="Details" action={<button className="btn-primary" disabled={busy}>Save</button>}>
            <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {TEXT.map(([k, label]) => <Field key={k} label={label}><input className="input" value={(o[k] as string | null) ?? ""} onChange={(e) => setO({ ...o, [k]: e.target.value })} /></Field>)}
            </div>
          </Card>
        </form>
        <OrgEmail orgName={o.name || "Your church"} />
      </div>
    </>
  );
}
