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

/** A picture in the backgrounds or logos library. The file syncs to every Mac you sign in on. */
export interface BoardBackground { id: string; name: string; bytes: number; at: string }

/**
 * A logo on the schedule: from `date`, on the days it repeats, until `until` (inclusive), all day or
 * between `from` and `to`. When several fit, one with times beats an all-day one, and the one added
 * later beats the one added earlier. Nothing scheduled: the default logo.
 */
export interface LogoRule {
  id: string;
  logoId: string;
  /** First day, "YYYY-MM-DD". */
  date: string;
  repeat: "none" | "daily" | "weekly" | "monthly" | "yearly";
  /** Weekly: which days (0 = Sunday). Empty: the first day's weekday. */
  days: number[];
  until: string | null;
  /** "HH:MM" (24-hour); both null = all day. */
  from: string | null;
  to: string | null;
}

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
  /**
   * The stage plot under the clock: a PDF's page (made into a picture in the browser) or a picture,
   * synced like the backgrounds. `dark` shows a white page as a dark one (inverted, colors kept).
   */
  plot: { fileId: string | null; name: string | null; dark: boolean };
  /** Your logos (the default is center.logoId), and when each one shows. */
  logos: BoardBackground[];
  logoSchedule: LogoRule[];
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
  extras: { channelId: string; micLabel: string; networked: boolean; status: TileStatus; note: string | null; bars: number | null; minutes: number | null; percent: number | null }[];
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
    plot: { url: string; dark: boolean } | null;
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
  names: "first", tileText: {}, tileColor: {}, center: { logoId: null, clock: "time", seconds: true, date: true }, plot: { fileId: null, name: null, dark: true }, logos: [], logoSchedule: [], columns: 0,
  lan: false, screen: { enabled: false, displayId: null },
};

/* ───────────── The logo schedule ───────────── */

const pad2 = (n: number) => String(n).padStart(2, "0");
/** "YYYY-MM-DD" for a day in local time. */
export const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parts = (day: string) => day.split("-").map(Number) as [number, number, number];
export const weekday = (day: string) => { const [y, m, d] = parts(day); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

/** Whether a rule falls on a day ("YYYY-MM-DD"), ignoring its times. */
export function occursOn(r: LogoRule, day: string): boolean {
  if (day < r.date || (r.until && day > r.until)) return false;
  const [, m, d] = parts(day), [, m0, d0] = parts(r.date);
  switch (r.repeat) {
    case "none": return day === r.date;
    case "daily": return true;
    case "weekly": return (r.days.length ? r.days : [weekday(r.date)]).includes(weekday(day));
    case "monthly": return d === d0;
    case "yearly": return d === d0 && m === m0;
  }
}

const minutes = (hhmm: string) => { const [h, mi] = hhmm.split(":").map(Number); return h * 60 + mi; };
/** Whether a rule is on at a moment (its day and, if it has them, its times; a window past midnight runs into the next day). */
export function ruleActive(r: LogoRule, now: Date): boolean {
  const day = ymd(now);
  if (!r.from || !r.to) return occursOn(r, day);
  const t = now.getHours() * 60 + now.getMinutes(), a = minutes(r.from), b = minutes(r.to);
  if (a <= b) return occursOn(r, day) && t >= a && t < b;
  const prev = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  return (occursOn(r, day) && t >= a) || (occursOn(r, prev) && t < b);
}

/** The logo showing at a moment: the schedule's, or the default. */
export function activeLogo(s: Pick<BoardSettings, "center" | "logos" | "logoSchedule">, now: Date): { logoId: string | null; rule: LogoRule | null } {
  const known = new Set((s.logos ?? []).map((l) => l.id));
  const on = (s.logoSchedule ?? []).filter((r) => known.has(r.logoId) && ruleActive(r, now));
  const rule = on.filter((r) => r.from && r.to).at(-1) ?? on.at(-1) ?? null;
  return { logoId: rule ? rule.logoId : s.center.logoId, rule };
}

/** "Every Sunday", "Yearly on Dec 25"… for the schedule's list. */
export function describeRule(r: LogoRule): string {
  const [y, m, d] = parts(r.date);
  const date = new Date(y, m - 1, d);
  const md = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  const when = {
    none: date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
    daily: "Every day",
    weekly: (() => { const ds = (r.days.length ? r.days : [weekday(r.date)]).slice().sort(); return ds.length === 7 ? "Every day" : `${ds.map((x) => names[x]).join(", ")}`; })(),
    monthly: `Monthly on the ${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`,
    yearly: `Yearly on ${md}`,
  }[r.repeat];
  const fmt = (hhmm: string) => { const [h, mi] = hhmm.split(":").map(Number); return new Date(2000, 0, 1, h, mi).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
  const time = r.from && r.to ? ` · ${fmt(r.from)}–${fmt(r.to)}` : "";
  const startsLater = r.date > ymd(new Date()) && !(r.repeat === "yearly" && y === new Date().getFullYear());
  const from = r.repeat !== "none" && startsLater ? ` · from ${md}${y !== new Date().getFullYear() ? `, ${y}` : ""}` : "";
  const until = r.until && r.repeat !== "none" ? ` until ${(() => { const [uy, um, ud] = parts(r.until!); return new Date(uy, um - 1, ud).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); })()}` : "";
  return `${when}${time}${from}${until}`;
}
