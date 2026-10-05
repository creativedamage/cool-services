"use client";
import type { RequestKind, RequestWorkflow } from "@shared/ops/workflow";
import { Check, Field, MoneyInput } from "./OpsUi";

export interface CategoryForm {
  name: string; icon: string; kind: RequestKind; workflow: RequestWorkflow; description: string; approvalThresholdCents: number | null;
  requiresLocation: boolean; allowLineItems: boolean; sortOrder: number; active: boolean;
}
export const emptyCategory = (): CategoryForm => ({ name: "", icon: "", kind: "MAINTENANCE", workflow: "WORK_ORDER", description: "", approvalThresholdCents: null, requiresLocation: false, allowLineItems: false, sortOrder: 0, active: true });

export function CategoryFields({ f, set }: { f: CategoryForm; set: (f: CategoryForm) => void }) {
  return (
    <>
      <Field label="Name"><input required className="input" value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} placeholder="Plumbing" /></Field>
      <Field label="Icon (emoji)"><input className="input" maxLength={8} value={f.icon} onChange={(e) => set({ ...f, icon: e.target.value })} placeholder="🚰" /></Field>
      <Field label="Kind">
        <select className="input" value={f.kind} onChange={(e) => set({ ...f, kind: e.target.value as RequestKind })}>
          <option value="TECHNOLOGY">Technology</option><option value="SUPPLY">Supplies</option><option value="MAINTENANCE">Facilities & Maintenance</option><option value="OTHER">Other</option>
        </select>
      </Field>
      <Field label="Workflow">
        <select className="input" value={f.workflow} onChange={(e) => set({ ...f, workflow: e.target.value as RequestWorkflow })}>
          <option value="APPROVAL">Approval → order → complete</option><option value="FULFILLMENT">Fulfillment (approve only over a threshold)</option><option value="WORK_ORDER">Work order (assign → in progress → done)</option>
        </select>
      </Field>
      <Field label="Description" className="md:col-span-2"><input className="input" value={f.description} onChange={(e) => set({ ...f, description: e.target.value })} /></Field>
      <Field label="Approval threshold (fulfillment only)"><MoneyInput nullable placeholder="e.g. 250.00" cents={f.approvalThresholdCents} onChange={(c) => set({ ...f, approvalThresholdCents: c })} /></Field>
      <Field label="Sort order"><input type="number" className="input" value={f.sortOrder} onChange={(e) => set({ ...f, sortOrder: parseInt(e.target.value) || 0 })} /></Field>
      <div className="flex flex-wrap gap-6 md:col-span-4">
        <Check label="Require a location (building / room)" checked={f.requiresLocation} onChange={(v) => set({ ...f, requiresLocation: v })} />
        <Check label="Pick items from a supply list" checked={f.allowLineItems} onChange={(v) => set({ ...f, allowLineItems: v })} />
        <Check label="Active" checked={f.active} onChange={(v) => set({ ...f, active: v })} />
      </div>
    </>
  );
}
