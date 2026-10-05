"use client";
/** Branding, contact details and quoting defaults (System admins). */
import { ImagePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { OrgSettings } from "@shared/ops/types";
import { ops, useOps, useOpsRefresh } from "@/lib/ops";
import { Card, Check, ErrorBox, Field, Loading, MoneyInput, PageHeader, PercentInput } from "@/components/ops/OpsUi";

type Data = { org: OrgSettings; logo: string | null; logoDark: string | null };
const TEXT: [keyof OrgSettings, string][] = [
  ["name", "Organization name"], ["legalName", "Legal name"], ["addressLine1", "Address"], ["addressLine2", "Address line 2"], ["city", "City"], ["state", "State"],
  ["postalCode", "ZIP"], ["phone", "Phone"], ["email", "Email"], ["website", "Website"], ["ein", "EIN (Federal Tax ID)"], ["salesTaxId", "Sales tax / exemption #"], ["quotePrefix", "Document prefix"],
];

export default function Organization() {
  const d = useOps<Data>("/settings/organization");
  if (!d.data) return <><PageHeader crumb="Settings" title="Organization" /><ErrorBox error={d.error} />{!d.error && <Loading />}</>;
  return <OrgForm key={JSON.stringify(d.data.org)} data={d.data} />;
}

function OrgForm({ data }: { data: Data }) {
  const refresh = useOpsRefresh();
  const [o, setO] = useState<OrgSettings>(data.org);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await ops("/settings/organization", { method: "PUT", json: o }); toast.success("Saved"); await refresh(); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader crumb="Settings" title="Organization" description="Branding, contact details and quoting defaults. They appear on every quote and printout." />
      <div className="space-y-5">
        <Card eyebrow="Branding" title="Logo">
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <Logo variant="light" current={data.logo} label="For light backgrounds (printouts)" />
            <Logo variant="dark" current={data.logoDark} label="For dark backgrounds (Sundays)" />
          </div>
        </Card>
        <form onSubmit={save} className="space-y-5">
          <Card eyebrow="Organization" title="Details" action={<button className="btn-primary" disabled={busy}>Save</button>}>
            <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {TEXT.map(([k, label]) => <Field key={k} label={label}><input className="input" value={(o[k] as string | null) ?? ""} onChange={(e) => setO({ ...o, [k]: e.target.value })} /></Field>)}
            </div>
          </Card>
          <Card eyebrow="AVL" title="Quoting defaults">
            <div className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Default tax %"><PercentInput bps={o.defaultTaxBps} onChange={(v) => setO({ ...o, defaultTaxBps: v })} /></Field>
              <Field label="Deposit %"><PercentInput bps={o.defaultDepositBps} onChange={(v) => setO({ ...o, defaultDepositBps: v })} /></Field>
              <Field label="Target margin %"><PercentInput bps={o.defaultMarginBps} onChange={(v) => setO({ ...o, defaultMarginBps: v })} /></Field>
              <Field label="Labor $/hr"><MoneyInput cents={o.laborRateCents} onChange={(v) => setO({ ...o, laborRateCents: v ?? 0 })} /></Field>
              <Field label="Quote valid (days)"><input type="number" className="input" value={o.quoteValidDays} onChange={(e) => setO({ ...o, quoteValidDays: parseInt(e.target.value) || 30 })} /></Field>
              <div className="flex items-end pb-2"><Check label="Tax exempt" checked={o.taxExempt} onChange={(v) => setO({ ...o, taxExempt: v })} /></div>
            </div>
            <div className="border-t border-line p-4">
              <Field label="Default quote terms & conditions"><textarea rows={6} className="input" value={o.quoteTerms ?? ""} onChange={(e) => setO({ ...o, quoteTerms: e.target.value })} /></Field>
            </div>
          </Card>
          <button className="btn-primary" disabled={busy}>Save settings</button>
        </form>
      </div>
    </>
  );
}

function Logo({ variant, current, label }: { variant: "light" | "dark"; current: string | null; label: string }) {
  const refresh = useOpsRefresh();
  const pick = async (file: File) => {
    try {
      if (file.size > 1024 * 1024) throw new Error("Use an image under 1 MB.");
      if (!["image/png", "image/jpeg", "image/svg+xml", "image/webp"].includes(file.type)) throw new Error("Use a PNG, JPG, SVG or WebP image.");
      const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
      await ops("/settings/organization/logo", { json: { variant, mime: file.type, dataB64: dataUrl.split(",")[1] } });
      toast.success("Logo updated"); await refresh();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className={variant === "dark" ? "rounded-xl bg-[#0b0d12] p-4" : "rounded-xl bg-white p-4"}>
      <div className={variant === "dark" ? "text-xs text-white/60" : "text-xs text-black/60"}>{label}</div>
      <div className="my-3 grid h-20 place-items-center">{current ? <img src={current} alt="" className="max-h-16 max-w-[220px] object-contain" /> : <span className={variant === "dark" ? "text-sm text-white/40" : "text-sm text-black/40"}>No logo yet</span>}</div>
      <div className="flex gap-2">
        <label className="btn-outline cursor-pointer bg-transparent"><ImagePlus size={14} /> Choose…<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} /></label>
        {current && <button className="btn-ghost text-bad" onClick={async () => { await ops(`/settings/organization/logo/${variant}`, { method: "DELETE" }); await refresh(); }}><Trash2 size={14} /> Remove</button>}
      </div>
    </div>
  );
}
