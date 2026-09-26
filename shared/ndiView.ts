/** NDI sources shown on the dashboard (received by the Mac app). */
export interface NdiViewerBridge {
  available(): { ok: boolean; error?: string };
  sources(): Promise<{ name: string }[]>;
  frame(name: string): { jpeg: Buffer; at: number; size: string } | null;
}
