/**
 * The stage display: the mic board (Micboard, built in) or the production clock, under a banner. The
 * main app chooses which one shows, or lets it follow the service: the mic board from before a
 * rehearsal or service until it ends, the idle choice otherwise. (The tiles below also feed the FOH
 * companion's mic strip.)
 */

export type DisplayView = "micboard" | "clock";
export type DisplayMode = "auto" | DisplayView;

export interface BoardSettings {
  /** What the display shows ("auto": the mic board around rehearsals and services). */
  mode: DisplayMode;
  /** In auto, outside rehearsal and service times. */
  autoIdle: DisplayView;
  /** "open": the service you have open in Sundays (else the next one); "next": always the next service. */
  follow: "open" | "next";
  /** For "next" (and before any service is opened): which service type (null = any). */
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
  /** Mics you've hidden from the board (mic setup channel ids). */
  hidden: string[];
  /** A person with more than one mic gets one tile, with their other mics stacked on it. */
  stack: boolean;
  /**
   * The mic board is Micboard (creativedamage/micboard, running inside Sundays). How the
   * display shows it: which Micboard group (0 = all slots), TV view with its info drawer (or the
   * desk view), and background pictures/videos (from Preferences → Micboard).
   */
  micboard: { group: number; view: "desk" | "elinfo00" | "elinfo01" | "elinfo10" | "elinfo11"; backgrounds: "NONE" | "IMG" | "MP4" };
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
  /** Read from a receiver (false: a mic that isn't on the network, shown for who has it). */
  networked: boolean;
  /** The same person's other mics, stacked on this tile (e.g. their acoustic guitar's pack). */
  extras: { channelId: string; micLabel: string; networked: boolean; status: TileStatus; note: string | null; bars: number | null; minutes: number | null }[];
}

/** A mic in the board's list (Display settings → Mics on the board). */
export interface BoardMic { id: string; label: string; kind: "vocal" | "pack" | "other"; networked: boolean; hidden: boolean }

export interface DisplayState {
  /** What's showing now, and why. */
  view: DisplayView;
  mode: DisplayMode;
  reason: string;
  settings: Pick<BoardSettings, "banner" | "columns" | "imageStyle">;
  /** Micboard, for the mic board view: its port on this Mac and the #hash that picks group/view/backgrounds. */
  micboard: { running: boolean; port: number; hash: string; rev: string; error: string | null } | null;
  service: { planId: string; serviceTypeId: string; title: string; serviceTypeName: string; when: string; nextTime: string | null } | null;
  tiles: BoardTile[];
  error: string | null;
  at: string;
}

export const DEFAULT_BOARD: BoardSettings = {
  mode: "auto", autoIdle: "micboard", follow: "open", serviceTypeId: null,
  banner: { enabled: true, text: "", scroll: false, size: "m", background: "#0B1220", color: "#FFFFFF", showService: true, showClock: true },
  images: "custom-then-pco", imageStyle: "background", customImages: {}, kinds: ["vocal", "pack", "other"], hideUnassigned: false, hidden: [], stack: true, columns: 0,
  micboard: { group: 0, view: "elinfo11", backgrounds: "IMG" },
  lan: false, screen: { enabled: false, displayId: null },
};
