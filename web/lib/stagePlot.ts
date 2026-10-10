"use client";
/**
 * A stage plot for the mic board: a PDF's page drawn into a picture here in the browser (pdf.js), or
 * a picture as it is, sized for a TV and kept under about 600 KB so it syncs to your other Macs.
 */

const MAX_BYTES = 600_000;
const fits = (d: string) => d.length * 0.75 < MAX_BYTES;

/** A canvas as the smallest picture that still looks sharp: PNG for line drawings, else WebP or JPEG. */
function encode(c: HTMLCanvasElement): string {
  const png = c.toDataURL("image/png");
  if (fits(png)) return png;
  for (const q of [0.92, 0.85, 0.75]) { const w = c.toDataURL("image/webp", q); if (w.startsWith("data:image/webp") && fits(w)) return w; }
  for (const q of [0.88, 0.78, 0.68]) { const j = c.toDataURL("image/jpeg", q); if (fits(j)) return j; }
  return c.toDataURL("image/jpeg", 0.6);
}

/**
 * The page cropped to its drawing: the white margin around it is cut off (leaving a little), so the
 * plot fills as much of the board's middle as it can.
 */
function trim(c: HTMLCanvasElement): HTMLCanvasElement {
  const g = c.getContext("2d")!;
  const { width: w, height: h } = c;
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const i = (y * w + x) * 4;
    if (d[i + 3] > 16 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return c; // a blank page
  const pad = Math.round(Math.max(w, h) * 0.015);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  if (x1 - x0 > w * 0.97 && y1 - y0 > h * 0.97) return c;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Shrink a canvas to at most `max` px on its long side. */
function scaled(src: HTMLCanvasElement | HTMLImageElement, w: number, h: number, max: number) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); // a PDF page is white under its drawing
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export async function pdfPageCount(file: File): Promise<number> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try { return doc.numPages; } finally { void doc.destroy(); }
}

/** The picture to upload for a stage plot file (PDF: the chosen page, 1-based). */
export async function stagePlotImage(file: File, page = 1): Promise<string> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    try {
      const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
      const base = p.getViewport({ scale: 1 });
      // About 2400 px on the long side: sharp on a 4K TV's middle third, and small enough to sync.
      const vp = p.getViewport({ scale: 2400 / Math.max(base.width, base.height) });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext("2d")!;
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
      await p.render({ canvasContext: g, viewport: vp }).promise;
      const t = trim(c);
      for (const max of [2400, 2000, 1600, 1280]) { const d = encode(scaled(t, t.width, t.height, max)); if (fits(d)) return d; }
      return encode(scaled(t, t.width, t.height, 1000));
    } finally { void doc.destroy(); }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn’t a PDF or a picture this browser can open.")); i.src = url; });
    for (const max of [2400, 2000, 1600, 1280]) { const d = encode(scaled(img, img.naturalWidth, img.naturalHeight, max)); if (fits(d)) return d; }
    return encode(scaled(img, img.naturalWidth, img.naturalHeight, 1000));
  } finally { URL.revokeObjectURL(url); }
}

let pdfjsP: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs() {
  return (pdfjsP ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  }));
}
