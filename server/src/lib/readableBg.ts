/**
 * Makes Micboard's names readable on any background picture.
 *
 * Micboard (vendor/micboard, unchanged) always writes the mic and the person's name in light text
 * on top of the picture: the mic at the top, the name across the middle. On a bright photo (a
 * white wall, a sunny day) that text disappears. So before a picture goes in Micboard's
 * backgrounds folder, Sundays measures how bright it is where the text sits and, only if it's too
 * bright, darkens the whole picture just enough (like a dark overlay) for the light text to stand
 * out. Pictures that are already dark enough are left exactly as they are.
 *
 * Plain JavaScript (jpeg-js), so nothing native has to be bundled into the Mac app.
 */
import jpeg from "jpeg-js";

/** Micboard's name color, #D7D7D7, as relative luminance. */
const TEXT_LUMINANCE = 0.6795;
/**
 * The brightest the picture may be behind the text: 0.16 gives the light text a contrast of at
 * least 3.4 : 1 (WCAG's minimum for large text is 3 : 1; Micboard's names are large).
 */
export const MAX_BACKGROUND_LUMINANCE = 0.16;
/** Never darker than this (keep the picture recognizable even on a near-white photo). */
const MIN_FACTOR = 0.2;

const toLinear = new Float64Array(256);
for (let v = 0; v < 256; v++) { const c = v / 255; toLinear[v] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const toSrgb8 = (l: number) => {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

export const contrastWith = (bgLuminance: number) => (TEXT_LUMINANCE + 0.05) / (bgLuminance + 0.05);

/**
 * How bright the picture is behind Micboard's text: the 80th percentile of luminance in the top
 * band (the mic) and the middle band (the name), across the middle of the picture (Micboard fills
 * a tall tile with it, so the sides are usually cropped off). The brighter of the two.
 */
export function textAreaLuminance(data: Uint8Array, width: number, height: number) {
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40_000))); // ~40k samples whatever the size
  const band = (y0: number, y1: number) => {
    const vals: number[] = [];
    for (let y = Math.floor(height * y0); y < Math.floor(height * y1); y += step) {
      for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x += step) {
        const i = (y * width + x) * 4;
        vals.push(0.2126 * toLinear[data[i]] + 0.7152 * toLinear[data[i + 1]] + 0.0722 * toLinear[data[i + 2]]);
      }
    }
    if (!vals.length) return 0;
    vals.sort((a, b) => a - b);
    return vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.8))];
  };
  return Math.max(band(0, 0.2), band(0.3, 0.7));
}

/**
 * The EXIF orientation of a JPEG (1 = upright; 2–8 = the viewer turns or flips it). Re-encoding
 * drops EXIF, so a picture that relies on it would come out sideways.
 */
export function exifOrientation(b: Buffer): number {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1], len = b.readUInt16BE(i + 2);
    if (marker === 0xda) break; // image data starts: no more headers
    if (marker === 0xe1 && b.toString("latin1", i + 4, i + 10) === "Exif\0\0") {
      const t = i + 10, le = b.toString("latin1", t, t + 2) === "II";
      const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
      const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
      if (t + 8 > b.length) return 1;
      const ifd = t + u32(t + 4);
      if (ifd + 2 > b.length) return 1;
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 10 > b.length) break;
        if (u16(e) === 0x0112) return u16(e + 8);
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

export interface Readable { data: Buffer; darkened: boolean; factor: number; before: number }

/**
 * The picture Micboard should show: the original if its text area is dark enough (or it isn't a
 * JPEG this can read), else a copy darkened evenly, in linear light, exactly as a black overlay of
 * (1 − factor) opacity would.
 */
export function readableBackground(original: Buffer): Readable {
  const same = (before = 0): Readable => ({ data: original, darkened: false, factor: 1, before });
  if (original.length < 4 || original[0] !== 0xff || original[1] !== 0xd8) return same(); // not a JPEG
  if (exifOrientation(original) !== 1) return same(); // turned by its EXIF: re-encoding would lose that
  let img: { width: number; height: number; data: Uint8Array };
  try { img = jpeg.decode(original, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 768, maxResolutionInMP: 120 }); }
  catch { return same(); }
  const before = textAreaLuminance(img.data, img.width, img.height);
  if (before <= MAX_BACKGROUND_LUMINANCE) return same(before);
  const factor = Math.max(MIN_FACTOR, MAX_BACKGROUND_LUMINANCE / before);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = toSrgb8(toLinear[v] * factor);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
  const out = jpeg.encode({ data: d, width: img.width, height: img.height }, 88);
  return { data: Buffer.from(out.data), darkened: true, factor, before };
}
