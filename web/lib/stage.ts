"use client";
import {
  AudioLines, Cable, Drum, Guitar, Headphones, Mic, MicVocal, Piano, Plug, Speaker, Square, Type, User, Volume2, type LucideIcon,
} from "lucide-react";
import type { MicAssignment, MicChannel, PlanDetail, PlotItem, PlotItemType, PlotPerson } from "@shared/types";

export const ITEM_TYPES: { type: PlotItemType; label: string; icon: LucideIcon; group: string }[] = [
  { type: "vocal", label: "Vocal mic", icon: MicVocal, group: "Mics & inputs" },
  { type: "mic", label: "Instrument mic", icon: Mic, group: "Mics & inputs" },
  { type: "di", label: "DI box", icon: Cable, group: "Mics & inputs" },
  { type: "power", label: "Power", icon: Plug, group: "Mics & inputs" },
  { type: "wedge", label: "Wedge", icon: Volume2, group: "Monitoring" },
  { type: "iem", label: "In-ears", icon: Headphones, group: "Monitoring" },
  { type: "amp", label: "Amp", icon: Speaker, group: "Monitoring" },
  { type: "acoustic", label: "Acoustic", icon: Guitar, group: "Instruments" },
  { type: "electric", label: "Electric", icon: Guitar, group: "Instruments" },
  { type: "bass", label: "Bass", icon: AudioLines, group: "Instruments" },
  { type: "keys", label: "Keys", icon: Piano, group: "Instruments" },
  { type: "drums", label: "Drums", icon: Drum, group: "Instruments" },
  { type: "person", label: "Person", icon: User, group: "Stage" },
  { type: "riser", label: "Riser", icon: Square, group: "Stage" },
  { type: "label", label: "Text", icon: Type, group: "Stage" },
];
export const itemInfo = (t: PlotItemType) => ITEM_TYPES.find((x) => x.type === t)!;

export const COMMON_POSITIONS = ["Worship Leader", "Vocals", "Acoustic Guitar", "Electric Guitar", "Bass", "Keys", "Drums", "Tracks", "Pastor", "Host"];

export const newItem = (type: PlotItemType, x = 0.5, y = 0.5): PlotItem => ({
  id: Math.random().toString(36).slice(2, 10),
  type, x, y, rotation: 0,
  label: type === "label" ? "Text" : type === "riser" ? "Riser" : itemInfo(type).label,
  link: null,
  ...(type === "riser" ? { w: 0.22, h: 0.16 } : type === "label" ? { w: 0.2 } : {}),
});

const isCard = (i: PlotItem) => i.type !== "riser" && i.type !== "label";
const clash = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 0.15 && Math.abs(a.y - b.y) < 0.12;
const SPOTS = (() => {
  const out: { x: number; y: number }[] = [];
  for (const y of [0.55, 0.42, 0.68, 0.29, 0.81, 0.16]) for (const dx of [0, 0.16, -0.16, 0.32, -0.32]) out.push({ x: 0.5 + dx, y });
  return out;
})();

/** A free spot for a new card: centre stage first, then outwards, avoiding other cards. */
export function freeSpot(items: PlotItem[]): { x: number; y: number } {
  const cards = items.filter(isCard);
  return SPOTS.find((s) => cards.every((i) => !clash(i, s))) ?? { x: 0.5, y: 0.5 };
}

/** Move any card that overlaps another to the nearest free spot. Risers and text stay put. */
export function tidy(items: PlotItem[]): PlotItem[] {
  const placed: PlotItem[] = [];
  return items.map((it) => {
    if (!isCard(it)) return it;
    let next = it;
    if (placed.some((p) => clash(p, it))) {
      const spot = [...SPOTS].sort((a, b) => Math.hypot(a.x - it.x, a.y - it.y) - Math.hypot(b.x - it.x, b.y - it.y))
        .find((s) => placed.every((p) => !clash(p, s)));
      if (spot) next = { ...it, ...spot };
    }
    placed.push(next);
    return next;
  });
}

export const CARD_COLORS = ["#334155", "#2563EB", "#7C3AED", "#059669", "#D97706", "#DC2626", "#DB2777", "#0891B2", "#F8FAFC"];
export const DEFAULT_CARD = { color: "#334155", radius: 10 };

/** Dark or light text, whichever reads better on the card color. */
export function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#0F172A" : "#FFFFFF";
}

/**
 * Who each card shows for a given service, with their position and every mic assigned to them.
 * Linked to a mic → the person on that mic. Linked to a position → everyone serving in it.
 */
export function peopleForPlan(
  items: PlotItem[], plan: PlanDetail | undefined, mics: MicAssignment[] | undefined, channels: MicChannel[] | undefined,
): Map<string, PlotPerson[]> {
  const out = new Map<string, PlotPerson[]>();
  if (!plan) return out;
  const serving = plan.roster.filter((m) => m.status !== "D");
  const label = new Map((channels ?? []).map((c) => [c.id, c.label]));
  const micsOf = (personId: string) => (mics ?? []).filter((a) => a.personId === personId).map((a) => label.get(a.channelId) ?? "Mic");
  const positionsOf = (personId: string) => [...new Set(serving.filter((m) => m.personId === personId).map((m) => m.positionName))].join(" · ");

  for (const it of items) {
    if (it.link?.kind === "mic") {
      const channelId = it.link.channelId;
      const a = mics?.find((m) => m.channelId === channelId);
      if (a) out.set(it.id, [{ name: a.name, position: positionsOf(a.personId), mics: micsOf(a.personId) }]);
    } else if (it.link?.kind === "position") {
      const pos = it.link.position.trim().toLowerCase();
      const ids = [...new Set(serving.filter((m) => m.positionName.toLowerCase() === pos).map((m) => m.personId))];
      const list = ids.map((id) => {
        const m = serving.find((x) => x.personId === id)!;
        return { name: m.name, position: it.link!.kind === "position" ? (it.link as { position: string }).position : m.positionName, mics: micsOf(id) };
      });
      if (list.length) out.set(it.id, list);
    }
  }
  return out;
}

/** Turn one page of a PDF into a sharp PNG (done on this Mac; the PDF itself isn't stored). */
export async function pdfPageToImage(file: File, pageNumber = 1) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, 2400 / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height, pages: doc.numPages };
}

export async function imageFileToDataUrl(file: File) {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const { width, height } = await new Promise<{ width: number; height: number }>((res, rej) => {
    const img = new Image();
    img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = rej;
    img.src = dataUrl;
  });
  return { dataUrl, width, height };
}
