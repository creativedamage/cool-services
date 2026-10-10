/**
 * The stage display: the mic board or the production clock, under a banner. The main app chooses
 * which one shows, or lets it follow the service: the mic board from before a rehearsal or service
 * until it ends, the idle choice otherwise. (The tiles below also feed the FOH companion's mic strip.)
 *
 * The mic board: a photo card per mic, half the mics down the left and half down the right, and in
 * the middle your logo over the clock (the time of day, or the production clock's countdown with
 * the name of the timer under it).
 */

export type DisplayView = "micboard" | "clock";
export type DisplayMode = "auto" | DisplayView;

/** A picture in the backgrounds library. The file syncs to every Mac you sign in on. */
export interface BoardBackground { id: string; name: string; bytes: number; at: string }

export interface BoardSettings {
  /** What the display shows ("auto": the mic board around rehearsals and services). */
  mode: DisplayMode;
  /** In auto, outside rehearsal and service times. */
  autoIdle: DisplayView;
  /** "open": the service you have open in Sundays (else the weekend's); "weekend": the picked weekend's service. */
  follow: "open" | "weekend";
  /** Which service type's service in the weekend (null = the weekend's first of any type). */
  serviceTypeId: string | null;
  banner: { enabled: boolean; text: string; scroll: boolean; size: "s" | "m" | "l"; background: string; color: string; showService: boolean; showClock: boolean };
  /** Card pictures: your own picture first (if there is one), else the Planning Center photo; or none. */
  images: "custom-then-pco" | "pco" | "custom" | "none";
  /** Kept for older settings; the mic board always shows pictures as photo cards. */
  imageStyle: "background" | "icon" | "none";
  /**
   * Pictures you've picked: "person:<Planning Center id>" (wherever they are) or "mic:<channel id>"
   * → a background's id. A background named like a person ("Eddie", "Eddie Smith") is theirs
   * without picking it.
   */
  customImages: Record<string, string>;
  /** The backgrounds library. */
  backgrounds: BoardBackground[];
  /** Which mics are on the board. */
  kinds: ("vocal" | "pack" | "other")[];
  hideUnassigned: boolean;
  /** Mics you've hidden from the board (mic setup channel ids). */
  hidden: string[];
  /** A person with more than one mic gets one card, with their other mics on its label. */
  stack: boolean;
  /** First names ("EDDIE") or full names on the cards. */
  names: "first" | "full";
  /** Per mic (channel id): a line of your own under the mic's name, and the label's color. */
  tileText: Record<string, string>;
  tileColor: Record<string, string>;
  /**
   * The middle: your logo (a background-library-style file, synced) over the clock, which is the
   * time of day (with the date under it) or the production clock's main timer (with its name).
   */
  center: { logoId: string | null; clock: "time" | "production"; seconds: boolean; date: boolean };
  /** Cards per row on each side (0 = fit automatically). */
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
  /** Picture for the card (a Planning Center photo URL or /api/board-out/image/<file>). */
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
  /** The same person's other mics, on this card's label (e.g. their acoustic guitar's pack). */
  extras: { channelId: string; micLabel: string; networked: boolean; status: TileStatus; note: string | null; bars: number | null; minutes: number | null }[];
  /** The label's color and your own line under the mic's name. */
  color: string;
  text: string | null;
}

/** A mic in the board's list (Display settings → Mics on the board). */
export interface BoardMic { id: string; label: string; kind: "vocal" | "pack" | "other"; networked: boolean; hidden: boolean }

export interface DisplayState {
  /** What's showing now, and why. */
  view: DisplayView;
  mode: DisplayMode;
  reason: string;
  settings: Pick<BoardSettings, "banner" | "columns" | "names"> & {
    center: { logo: string | null; clock: "time" | "production"; seconds: boolean; date: boolean };
  };
  service: { planId: string; serviceTypeId: string; title: string; serviceTypeName: string; when: string; nextTime: string | null } | null;
  tiles: BoardTile[];
  error: string | null;
  at: string;
}

/** Label colors, in order, for mics you haven't given one. Bright enough to read on the dark board. */
export const TILE_COLORS = ["#4ADE80", "#C084FC", "#E3DD6C", "#E5E7EB", "#5EEAD4", "#8B5CF6", "#F87171", "#FB923C", "#60A5FA", "#F472B6"];

export const DEFAULT_BOARD: BoardSettings = {
  mode: "auto", autoIdle: "micboard", follow: "weekend", serviceTypeId: null,
  banner: { enabled: false, text: "", scroll: false, size: "m", background: "#0B1220", color: "#FFFFFF", showService: true, showClock: true },
  images: "custom-then-pco", imageStyle: "background", customImages: {}, backgrounds: [], kinds: ["vocal", "pack", "other"], hideUnassigned: false, hidden: [], stack: true,
  names: "first", tileText: {}, tileColor: {}, center: { logoId: null, clock: "time", seconds: true, date: true }, columns: 0,
  lan: false, screen: { enabled: false, displayId: null },
};
