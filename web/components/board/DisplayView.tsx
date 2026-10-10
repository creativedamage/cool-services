"use client";
/**
 * The stage display as it appears on a TV / stage screen / second display: the mic board (with the
 * clock in its middle). Sized by its container, so the same thing works full screen and as a preview.
 */
import { useRef } from "react";
import type { BoardTile, DisplayState } from "@shared/board";
import type { TileHistory } from "./MicBoard";
import { SideStage } from "./SideStage";

/** Recent audio and RF readings per mic (kept on this screen) for the graphs; `at` changes with new readings. */
export function useTileHistory(tiles: BoardTile[], at: string) {
  const ref = useRef(new Map<string, TileHistory>());
  const last = useRef("");
  if (at !== last.current) {
    last.current = at;
    for (const t of tiles) {
      const h = ref.current.get(t.channelId) ?? { audio: [], rf: [] };
      h.audio = [...h.audio, t.audio ?? 0].slice(-40);
      h.rf = [...h.rf, t.rf?.dbm != null ? Math.max(0, t.rf.dbm + 100) : 0].slice(-40);
      ref.current.set(t.channelId, h);
    }
  }
  return ref.current;
}

/** The stage display: the mic board, filling whatever it's in (full screen, or the preview in the app). */
export function DisplayView({ s, now }: { s: DisplayState; now: number }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-white [container-type:size]">
      <SideStage s={s} now={now} />
    </div>
  );
}
