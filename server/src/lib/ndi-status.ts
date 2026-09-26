/**
 * NDI status, shared between the Mac app (which does the sending) and the Settings screen.
 * In a browser-only setup (npm run dev) NDI isn't available and this stays at its default.
 */
import type { NdiStatus } from "../../../shared/types.js";

let status: NdiStatus = { available: false, running: false, sourceName: null, connections: 0, width: 0, height: 0, fps: 0 };

export const ndiStatus = {
  get: () => status,
  set: (s: Partial<NdiStatus>) => { status = { ...status, ...s }; },
};
