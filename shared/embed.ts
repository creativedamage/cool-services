/** A Planning Center page shown inside the Cool Services window (the Mac app draws it natively). */
export interface EmbedRequest {
  /** "show" places it over the given rectangle (CSS pixels in the window); "hide" removes it. */
  action: "show" | "hide" | "reload" | "home";
  url?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}
export interface EmbedBridge {
  apply(req: EmbedRequest): { ok: boolean; url: string | null };
}
