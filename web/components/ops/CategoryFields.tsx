"use client";
/** A request type's look (icon, title, subtext) and how it flows. Used to add and to edit types. */
import clsx from "clsx";
import { ArrowRight } from "lucide-react";
import { KIND_LABEL, type RequestKind, type RequestWorkflow } from "@shared/ops/workflow";
import { Check, Field, MoneyInput } from "./OpsUi";
import { IconPicker, TypeIcon } from "./TypeIcon";
import { kindAllowed } from "@shared/ops/billing";
import { OpsMeContext } from "./context";
import { useContext } from "react";

export interface CategoryForm {
  name: string; icon: string; kind: RequestKind; workflow: RequestWorkflow; description: string; approvalThresholdCents: number | null;
  requiresLocation: boolean; allowLineItems: boolean; sortOrder: number; active: boolean;
}
export const emptyCategory = (): CategoryForm => ({ name: "", icon: "", kind: "MAINTENANCE", workflow: "WORK_ORDER", description: "", approvalThresholdCents: null, requiresLocation: false, allowLineItems: false, sortOrder: 0, active: true });

const KINDS: RequestKind[] = ["TECHNOLOGY", "SUPPLY", "MAINTENANCE", "OTHER"];
const WORKFLOWS: { key: RequestWorkflow; label: string; help: string; hint: string }[] = [
  { key: "WORK_ORDER", label: "Work order", help: "Assigned to someone, worked, then marked done.", hint: "Creates a work order" },
  { key: "APPROVAL", label: "Needs approval", help: "Approved first, then ordered and completed.", hint: "Needs approval" },
  { key: "FULFILLMENT", label: "Fulfillment", help: "Straight to the team; approval only over an amount.", hint: "Goes straight to the team" },
];

export function CategoryFields({ f, set }: { f: CategoryForm; set: (f: CategoryForm) => void }) {
  const modules = useContext(OpsMeContext)?.nav.modules ?? [];
  const kinds = KINDS.filter((k) => kindAllowed(k, modules) || k === f.kind);
  const wf = WORKFLOWS.find((w) => w.key === f.workflow)!;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="label mb-1.5">Icon</div>
          <IconPicker value={f.icon} onChange={(icon) => set({ ...f, icon })} />
        </div>
        <div className="space-y-4">
          <Field label="Title"><input required className="input" maxLength={100} value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} placeholder="e.g. Plumbing" /></Field>
          <Field label="Subtext" hint="One line under the title, so people know when to pick this.">
            <input className="input" maxLength={300} value={f.description} onChange={(e) => set({ ...f, description: e.target.value })} placeholder="e.g. Leaks, clogs, toilets and sinks" />
          </Field>
          <div>
            <div className="label mb-1.5">Preview</div>
            <div className="panel flex items-start gap-3 p-3.5">
              <TypeIcon icon={f.icon} kind={f.kind} />
              <span className="min-w-0 flex-1">
                <span className={clsx("block text-sm font-medium", !f.name && "text-ink-faint")}>{f.name || "Title"}</span>
                <span className={clsx("mt-0.5 block text-xs", f.description ? "text-ink-muted" : "text-ink-faint")}>{f.description || "Subtext"}</span>
                <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{wf.hint}</span>
              </span>
              <ArrowRight size={14} className="mt-1 text-ink-faint" />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 border-t border-line pt-5">
        <div>
          <div className="label mb-1.5">Shows under</div>
          <div className="inline-flex flex-wrap rounded-lg border border-line p-0.5">
            {kinds.map((k) => (
              <button key={k} type="button" onClick={() => set({ ...f, kind: k })}
                className={clsx("rounded-md px-3 py-1.5 text-xs font-medium transition", f.kind === k ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-hover")}>{KIND_LABEL[k]}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="label mb-1.5">How it's handled</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {WORKFLOWS.map((w) => (
              <button key={w.key} type="button" onClick={() => set({ ...f, workflow: w.key })}
                className={clsx("rounded-lg border p-2.5 text-left text-sm transition", f.workflow === w.key ? "border-accent/60 bg-accent-soft" : "border-line hover:border-line-strong")}>
                <span className="font-medium">{w.label}</span><span className="block text-[11px] text-ink-muted">{w.help}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {f.workflow === "FULFILLMENT" && (
            <Field label="Needs approval over" hint="Leave blank to never need approval."><MoneyInput nullable placeholder="e.g. 250.00" cents={f.approvalThresholdCents} onChange={(c) => set({ ...f, approvalThresholdCents: c })} /></Field>
          )}
          <Field label="Order in list" hint="Lower numbers show first."><input type="number" className="input" value={f.sortOrder} onChange={(e) => set({ ...f, sortOrder: parseInt(e.target.value) || 0 })} /></Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Check label="Ask for a location (building / room)" checked={f.requiresLocation} onChange={(v) => set({ ...f, requiresLocation: v })} />
          {modules.includes("supplies") && <Check label="Pick items from a supply list" checked={f.allowLineItems} onChange={(v) => set({ ...f, allowLineItems: v })} />}
          <Check label="Active (people can choose it)" checked={f.active} onChange={(v) => set({ ...f, active: v })} />
        </div>
      </div>
    </div>
  );
}
