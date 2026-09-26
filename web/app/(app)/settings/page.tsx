"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Cast, Laptop, Moon, Sun, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AppSettings, NdiStatus, StartView, ThemePref } from "@shared/types";
import { Api, qk, type SettingsPatch } from "@/lib/api";
import { usePlans } from "@/lib/plans";
import { setTheme } from "@/lib/theme";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/ui";
import { PagingSettings } from "@/components/paging/PagingSettings";
import { WavesSettings } from "@/components/settings/WavesSettings";
import { UpdatesSettings } from "@/components/settings/UpdatesSettings";

export default function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: qk.settings, queryFn: Api.settings });
  const workflows = useQuery({ queryKey: qk.workflows, queryFn: Api.workflows });
  const plans = usePlans();
  const fileRef = useRef<HTMLInputElement>(null);

  const ndiStatus = useQuery({ queryKey: ["ndiStatus"], queryFn: Api.ndiStatus, refetchInterval: 2000 });
  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => Api.saveSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.settings });
      qc.setQueryData<AppSettings>(qk.settings, (s) => s && {
        ...s, ...patch, ndi: { ...s.ndi, ...(patch.ndi ?? {}) },
        waves: { ...s.waves, ...(patch.waves ?? {}), snapshots: { ...s.waves.snapshots, ...(patch.waves?.snapshots ?? {}) } },
      });
    },
    onSuccess: (s) => qc.setQueryData(qk.settings, s),
    onError: (e) => { toast.error("Couldn’t save setting", { description: (e as Error).message }); void settings.refetch(); },
  });

  const s = settings.data;
  if (!s) return <div className="p-8"><Spinner /></div>;

  const serviceTypes = [...new Map((plans.data ?? []).map((p) => [p.serviceTypeId, p.serviceTypeName])).entries()];

  async function pickLogo(file: File) {
    if (file.size > 1_500_000) return toast.error("Please use an image under 1.5 MB");
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) return toast.error("Use a PNG, JPG, SVG or WebP image");
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    save.mutate({ logo: dataUrl }, { onSuccess: () => toast.success("Logo updated") });
  }

  const themeBtn = (pref: ThemePref, label: string, Icon: typeof Sun) => (
    <button onClick={() => { setTheme(pref); save.mutate({ theme: pref }); }}
      className={clsx("flex flex-1 flex-col items-center gap-2 rounded-xl border p-4 text-sm transition",
        s.theme === pref ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-soft hover:border-line-strong")}>
      <Icon size={20} /> {label}
    </button>
  );

  const startKey = (v: StartView) => v.kind === "workflow" ? `workflow:${v.workflowId}`
    : v.kind === "next-service" || v.kind === "next-checkins" ? `${v.kind}:${v.serviceTypeId ?? ""}` : v.kind;
  function setStart(key: string) {
    const [kind, arg] = key.split(":");
    const v: StartView = kind === "workflow" ? { kind, workflowId: arg }
      : kind === "next-service" || kind === "next-checkins" ? { kind, serviceTypeId: arg || null }
      : { kind: kind as "workflows" | "services" };
    save.mutate({ startView: v });
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-ink-muted">These apply to Cool Services on this Mac.</p>

      <div className="mt-6 max-w-2xl space-y-6">
        <section id="appearance" className="panel scroll-mt-6 p-5">
          <h2 className="font-semibold">Appearance</h2>
          <p className="mt-0.5 text-sm text-ink-muted">System follows your Mac’s light or dark setting.</p>
          <div className="mt-4 flex gap-3">
            {themeBtn("dark", "Dark", Moon)}
            {themeBtn("light", "Light", Sun)}
            {themeBtn("system", "System", Laptop)}
          </div>
        </section>

        <section id="logo" className="panel scroll-mt-6 p-5">
          <h2 className="font-semibold">Logo</h2>
          <p className="mt-0.5 text-sm text-ink-muted">Shown in the sidebar and on the sign-in page. A square PNG or SVG works best.</p>
          <div className="mt-4 flex items-center gap-4">
            <div className="grid h-20 w-20 place-items-center rounded-2xl border border-line bg-canvas"><Logo size={56} /></div>
            <div className="flex gap-2">
              <button className="btn-outline" onClick={() => fileRef.current?.click()}><Upload size={14} /> Upload logo</button>
              {s.logo && <button className="btn-ghost" onClick={() => save.mutate({ logo: null })}><Trash2 size={14} /> Use default</button>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickLogo(f); e.target.value = ""; }} />
          </div>
        </section>

        <section id="start" className="panel scroll-mt-6 p-5">
          <h2 className="font-semibold">When Cool Services opens</h2>
          <p className="mt-0.5 text-sm text-ink-muted">The first screen you see after opening the app or signing in.</p>
          <select className="input mt-4" value={startKey(s.startView)} onChange={(e) => setStart(e.target.value)}>
            <option value="workflows">Workflows overview</option>
            <optgroup label="A specific workflow">
              {workflows.data?.map((w) => <option key={w.id} value={`workflow:${w.id}`}>{w.name}</option>)}
            </optgroup>
            <option value="services">Services overview</option>
            <optgroup label="The next service">
              <option value="next-service:">Next service (any type)</option>
              {serviceTypes.map(([id, name]) => <option key={id} value={`next-service:${id}`}>Next {name}</option>)}
            </optgroup>
            <optgroup label="Check-ins for the next service">
              <option value="next-checkins:">Check-ins · next service (any type)</option>
              {serviceTypes.map(([id, name]) => <option key={id} value={`next-checkins:${id}`}>Check-ins · next {name}</option>)}
            </optgroup>
          </select>
        </section>

        <UpdatesSettings />

        <NdiSection s={s} status={ndiStatus.data} serviceTypes={serviceTypes} onChange={(ndi) => save.mutate({ ndi })} />

        <WavesSettings w={s.waves} onChange={(waves) => save.mutate({ waves })} />

        <PagingSettings />
      </div>
    </div>
  );
}

function NdiSection({ s, status, serviceTypes, onChange }: {
  s: AppSettings; status: NdiStatus | undefined; serviceTypes: [string, string][];
  onChange: (ndi: Partial<AppSettings["ndi"]>) => void;
}) {
  const n = s.ndi;
  const [name, setName] = useState(n.name);
  useEffect(() => setName(n.name), [n.name]);
  const unavailable = status && !status.available;
  return (
    <section id="ndi" className="panel scroll-mt-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Cast size={16} /> Stage plot over NDI<sup className="text-[9px]">®</sup></h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Sends the next service’s stage plot as a live NDI source, so you can add it as an input in ProPresenter (or any NDI receiver) and put it on a multiview.
          </p>
        </div>
        <button role="switch" aria-checked={n.enabled} disabled={unavailable} onClick={() => onChange({ enabled: !n.enabled })}
          className={clsx("relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40", n.enabled ? "bg-ok" : "bg-line-strong")}>
          <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", n.enabled ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>

      <div className={clsx("mt-3 rounded-lg border px-3 py-2 text-xs",
        unavailable || status?.error ? "border-bad/30 bg-bad-soft text-bad" : status?.running ? "border-ok/30 bg-ok-soft text-ok" : "border-line text-ink-muted")}>
        {!status ? "Checking…"
          : unavailable ? (status.error ?? "NDI is only available in the Cool Services Mac app.")
          : status.error ? status.error
          : status.running ? <>Sending <b>{status.sourceName}</b> · {status.width}×{status.height} at {status.fps} fps · {status.connections} receiver{status.connections === 1 ? "" : "s"} connected</>
          : "Off. Turn it on to start sending."}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">NDI source name</span>
          <input className="input mt-1" value={name} maxLength={60} onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== n.name && onChange({ name: name.trim() })} />
          <span className="mt-1 block text-[11px] text-ink-faint">Receivers show it as “YOUR-MAC ({name || "…"})”.</span>
        </label>
        <label className="block">
          <span className="label">Show</span>
          <select className="input mt-1" value={n.serviceTypeId ?? ""} onChange={(e) => onChange({ serviceTypeId: e.target.value || null })}>
            <option value="">Next service (any type)</option>
            {serviceTypes.map(([id, nm]) => <option key={id} value={id}>Next {nm}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Resolution</span>
          <select className="input mt-1" value={n.resolution} onChange={(e) => onChange({ resolution: e.target.value as AppSettings["ndi"]["resolution"] })}>
            <option value="720p">1280 × 720</option><option value="1080p">1920 × 1080</option><option value="4k">3840 × 2160</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Frame rate</span>
          <select className="input mt-1" value={n.fps} onChange={(e) => onChange({ fps: Number(e.target.value) as 10 | 30 | 60 })}>
            <option value={10}>10 fps (lightest)</option><option value={30}>30 fps</option><option value={60}>60 fps</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Background</span>
          <select className="input mt-1" value={n.background} onChange={(e) => onChange({ background: e.target.value as "black" | "white" })}>
            <option value="black">Black</option><option value="white">White</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft sm:col-span-2">
          <input type="checkbox" checked={n.showHeader} onChange={(e) => onChange({ showHeader: e.target.checked })} />
          Show the service title and date along the top
        </label>
      </div>

      <div className="mt-4">
        <span className="label">Preview</span>
        <div className="mt-1 aspect-video w-full overflow-hidden rounded-lg border border-line bg-black">
          <iframe src="/ndi" title="NDI preview" className="pointer-events-none h-[1080px] w-[1920px] origin-top-left border-0"
            style={{ transform: "scale(var(--ndi-scale))" }}
            ref={(el) => { if (el?.parentElement) el.style.setProperty("--ndi-scale", String(el.parentElement.clientWidth / 1920)); }} />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-ink-faint">
        NDI® is a registered trademark of Vizrt NDI AB. <a className="underline" href="https://ndi.video" target="_blank" rel="noreferrer">ndi.video</a>
      </p>
    </section>
  );
}
