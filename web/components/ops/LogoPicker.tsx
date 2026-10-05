"use client";
/** Upload / remove a logo (stored in Sundays' cloud, under 1 MB). */
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useOpsRefresh } from "@/lib/ops";

export function LogoPicker({ current, label, dark, upload, remove, disabled }: {
  current: string | null; label: string; dark?: boolean; disabled?: boolean;
  upload: (mime: string, dataB64: string) => Promise<unknown>; remove: () => Promise<unknown>;
}) {
  const refresh = useOpsRefresh();
  const pick = async (file: File) => {
    try {
      if (file.size > 1024 * 1024) throw new Error("Use an image under 1 MB.");
      if (!["image/png", "image/jpeg", "image/svg+xml", "image/webp"].includes(file.type)) throw new Error("Use a PNG, JPG, SVG or WebP image.");
      const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
      await upload(file.type, dataUrl.split(",")[1]);
      toast.success("Logo updated"); await refresh();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className={dark ? "rounded-xl bg-[#0b0d12] p-4" : "rounded-xl bg-white p-4"}>
      <div className={dark ? "text-xs text-white/60" : "text-xs text-black/60"}>{label}</div>
      <div className="my-3 grid h-20 place-items-center">{current ? <img src={current} alt="" className="max-h-16 max-w-[220px] object-contain" /> : <span className={dark ? "text-sm text-white/40" : "text-sm text-black/40"}>No logo yet</span>}</div>
      {!disabled && (
        <div className="flex gap-2">
          <label className={dark ? "btn-outline cursor-pointer bg-transparent text-white" : "btn-outline cursor-pointer border-black/15 bg-transparent text-black"}><ImagePlus size={14} /> Choose…<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} /></label>
          {current && <button className="btn-ghost text-bad" onClick={async () => { await remove(); await refresh(); }}><Trash2 size={14} /> Remove</button>}
        </div>
      )}
    </div>
  );
}
