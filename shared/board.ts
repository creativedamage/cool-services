/**
 * The stage display: a board of the wireless mics (in the spirit of Micboard: a tile per mic with the
 * person's photo, name, battery, RF and audio), the stage plot, or the production clock. The main app
 * chooses which one shows, or lets it follow the service: stage plot during rehearsal times, mic
 * board during service times.
 */

export type DisplayView = "micboard" | "stageplot" | "clock";
export type DisplayMode = "auto" | DisplayView;

export interface BoardSettings {
  /** What the display shows ("auto": stage plot in rehearsal, mic board for services). */
  mode: DisplayMode;
  /** In auto, outside rehearsal and service times. */
  autoIdle: DisplayView;
  /** Which service the board follows (null = the next service of any type). */
  serviceTypeId: string | null;
  banner: { enabled: boolean; text: string; scroll: boolean; size: "s" | "m" | "l"; background: string; color: string; showService: boolean; showClock: boolean };
  /** Tile backgrounds: your own picture first (if there is one), else the Planning Center photo; or none. */
  images: "custom-then-pco" | "pco" | "custom" | "none";
  /** How the picture shows: filling the tile behind the name, as a round photo above the name, or not at all. */
  imageStyle: "background" | "icon" | "none";
  /** "person:<id>" or "mic:<channelId>" → uploaded image file id. */
  customImages: Record<string, string>;
  /** Which mics are on the board. */
  kinds: ("vocal" | "pack" | "other")[];
  hideUnassigned: boolean;
  /** Tiles per row on the display (0 = fit automatically). */
  columns: number;
  /** Network page (http://<this Mac>/display) and a second display on this Mac. */
  lan: boolean;
  screen: { enabled: boolean; displayId: number | null };
}

export type TileStatus = "ok" | "low" | "critical" | "txoff" | "offline" | "noreceiver";

export interface BoardTile {
  channelId: string;
  micLabel: string;
  kind: "vocal" | "pack" | "other";
  receiverName: string | null;
  channel: number;
  person: { id: string; name: string; firstName: string; position: string | null } | null;
  /** Picture for the tile background (a Planning Center photo URL or /api/board-out/image/<file>). */
  image: string | null;
  status: TileStatus;
  /** Words for the status ("TX OFF", "Low battery", "RF interference"). */
  note: string | null;
  battery: { bars: number | null; minutes: number | null; percent: number | null } | null;
  rf: { antennas: string | null; dbm: number | null } | null;
  audio: number | null;
  muted: boolean;
  frequencyMHz: number | null;
  txModel: string | null;
}

export interface DisplayState {
  /** What's showing now, and why. */
  view: DisplayView;
  mode: DisplayMode;
  reason: string;
  settings: Pick<BoardSettings, "banner" | "columns" | "imageStyle">;
  service: { planId: string; serviceTypeId: string; title: string; serviceTypeName: string; when: string; nextTime: string | null } | null;
  tiles: BoardTile[];
  /** For the stage plot view. */
  stage: {
    plot: { id: string; name: string; background: { url: string; width: number; height: number } | null; items: unknown[] } | null;
    roster: { personId: string; name: string; positionName: string; status: string }[];
    assignments: { channelId: string; personId: string; name: string }[];
    channels: { id: string; label: string; kind: string; positions: string[] }[];
  } | null;
  error: string | null;
  at: string;
}

export const DEFAULT_BOARD: BoardSettings = {
  mode: "auto", autoIdle: "micboard", serviceTypeId: null,
  banner: { enabled: true, text: "", scroll: false, size: "m", background: "#0B1220", color: "#FFFFFF", showService: true, showClock: true },
  images: "custom-then-pco", imageStyle: "background", customImages: {}, kinds: ["vocal", "pack", "other"], hideUnassigned: false, columns: 0,
  lan: false, screen: { enabled: false, displayId: null },
};
