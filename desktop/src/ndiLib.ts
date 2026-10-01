/**
 * NDI® sending through the NDI library itself (libndi.dylib), called with koffi.
 *
 * Nothing here is compiled on your Mac: koffi ships ready-built for Apple Silicon and Intel, and the
 * Mac build copies NDI's own library out of NDI's official installer into the app
 * (app/native/ndi/libndi.dylib, see build.mjs). If it isn't there, an installed NDI SDK / NDI
 * runtime is used instead. NDI® is a registered trademark of Vizrt NDI AB — https://ndi.video
 */
import fs from "node:fs";
import path from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
export interface NdiSender {
  /** Queue one frame (BGRA or BGRX, top-down). Resolves when NDI has taken it. */
  video(frame: { width: number; height: number; fps: number; alpha: boolean; data: Buffer }): Promise<void>;
  connections(): number;
  sourceName(): string;
  destroy(): void;
}
export interface Ndi { createSender(name: string): NdiSender }

const fourCC = (s: string) => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);
const unpacked = (p: string) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function libCandidates(): string[] {
  const own = unpacked(path.join(__dirname, "native", "ndi"));
  const env = process.env.COOL_NDI_LIB ? [process.env.COOL_NDI_LIB] : [];
  if (process.platform === "darwin") {
    return [...env, path.join(own, "libndi.dylib"), "/usr/local/lib/libndi.dylib", "/Library/NDI SDK for Apple/lib/macOS/libndi.dylib",
      "/Library/NDI Advanced SDK for Apple/lib/macOS/libndi_advanced.dylib"];
  }
  if (process.platform === "win32") return [...env, path.join(own, "Processing.NDI.Lib.x64.dll")];
  return [...env, path.join(own, "libndi.so.6"), path.join(own, "libndi.so"), "/usr/lib/libndi.so", "/usr/local/lib/libndi.so"];
}

let cached: { ndi: Ndi | null; error?: string; lib?: string } | null = null;

export function loadNdi(): { ndi: Ndi | null; error?: string; lib?: string } {
  if (cached) return cached;
  let koffi: any;
  try {
    koffi = require(unpacked(path.join(__dirname, "native", "koffi")));
  } catch {
    try { koffi = require("koffi"); } catch (e) {
      return (cached = { ndi: null, error: `NDI isn’t included in this build (koffi missing: ${(e as Error).message.split("\n")[0]}).` });
    }
  }
  const libPath = libCandidates().find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!libPath) return (cached = { ndi: null, error: "NDI isn’t included in this build: the NDI library (libndi) wasn’t found. Rebuild with npm run dist:mac, or install NDI Tools from ndi.video." });
  try {
    const lib = koffi.load(libPath);
    const SendCreate = koffi.struct("NDIlib_send_create_t", { p_ndi_name: "const char *", p_groups: "const char *", clock_video: "bool", clock_audio: "bool" });
    const VideoFrame = koffi.struct("NDIlib_video_frame_v2_t", {
      xres: "int", yres: "int", FourCC: "uint32_t", frame_rate_N: "int", frame_rate_D: "int", picture_aspect_ratio: "float",
      frame_format_type: "int", timecode: "int64_t", p_data: "uint8_t *", line_stride_in_bytes: "int", p_metadata: "const char *", timestamp: "int64_t",
    });
    const Source = koffi.struct("NDIlib_source_t", { p_ndi_name: "const char *", p_url_address: "const char *" });
    const initialize = lib.func("bool NDIlib_initialize()");
    const sendCreate = lib.func("void *NDIlib_send_create(const NDIlib_send_create_t *settings)");
    const sendDestroy = lib.func("void NDIlib_send_destroy(void *sender)");
    const sendVideo = lib.func("void NDIlib_send_send_video_v2(void *sender, const NDIlib_video_frame_v2_t *frame)");
    const connections = lib.func("int NDIlib_send_get_no_connections(void *sender, uint32_t timeout_ms)");
    const sourceName = lib.func("const NDIlib_source_t *NDIlib_send_get_source_name(void *sender)");
    void SendCreate; void VideoFrame;
    if (!initialize()) return (cached = { ndi: null, error: "NDI couldn’t start on this Mac (its processor may not be supported).", lib: libPath });

    const ndi: Ndi = {
      createSender(name) {
        // clock_video off: frames are paced by Cool Services, and sending never blocks.
        const inst = sendCreate({ p_ndi_name: name, p_groups: null, clock_video: false, clock_audio: false });
        if (!inst) throw new Error("NDI couldn’t create the source.");
        let alive = true;
        return {
          video: ({ width, height, fps, alpha, data }) => new Promise<void>((resolve, reject) => {
            if (!alive) return resolve();
            const frame = {
              xres: width, yres: height, FourCC: fourCC(alpha ? "BGRA" : "BGRX"), frame_rate_N: fps * 1000, frame_rate_D: 1000,
              picture_aspect_ratio: width / height, frame_format_type: 1 /* progressive */, timecode: 9223372036854775807n /* synthesize */,
              p_data: data, line_stride_in_bytes: width * 4, p_metadata: null, timestamp: 0n,
            };
            // On a worker thread: NDI compresses the frame there, not on the app's main thread.
            sendVideo.async(inst, frame, (err: Error | null) => (err ? reject(err) : resolve()));
          }),
          connections: () => (alive ? connections(inst, 0) : 0),
          sourceName: () => {
            try { const s = koffi.decode(sourceName(inst), Source); return s?.p_ndi_name ?? name; } catch { return name; }
          },
          destroy: () => { if (alive) { alive = false; sendDestroy(inst); } },
        };
      },
    };
    return (cached = { ndi, lib: libPath });
  } catch (e) {
    const m = (e as Error).message;
    const arch = /incompatible architecture|wrong architecture|mach-o/i.test(m) ? ` The NDI library doesn’t match this Mac’s processor (${process.arch}).` : "";
    return (cached = { ndi: null, error: `NDI couldn’t load.${arch} (${m.split("\n")[0]})`, lib: libPath });
  }
}
