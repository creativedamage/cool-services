/**
 * Domain DTOs shared by server and web (type-only imports).
 * The server flattens PCO's JSON:API into these shapes so the UI never deals with JSON:API.
 */

export interface Person {
  id: string; // PCO person id — identical across People and Services
  name: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  email: string | null;
  phone: string | null;
  /** The number marked "Mobile" in Planning Center (for texting), if there is one. */
  mobile?: string | null;
}

/** Everything the person panel shows (Matrix → click a person). */
export interface PersonProfile {
  person: Person;
  emails: { address: string; location: string | null; primary: boolean }[];
  phones: { number: string; location: string | null; primary: boolean }[];
  address: string | null;
  birthdate: string | null;
  membership: string | null;
  /** Upcoming Services schedule (every service type). */
  schedule: { planId: string | null; serviceTypeId: string | null; serviceTypeName: string; date: string; teamName: string; position: string; status: "C" | "U" | "D" }[];
  /** Upcoming blockouts. */
  blockouts: { id: string; reason: string | null; startsAt: string; endsAt: string }[];
  /** Active workflow cards: Planning Center can send email through these. */
  cards: { id: string; workflowName: string }[];
  /** The person's page in Planning Center People. */
  url: string;
}

export interface StaffMe extends Person {
  orgName: string;
  demo: boolean;
}

/* ───────────── People / Workflows ───────────── */

export interface WorkflowSummary {
  id: string;
  name: string;
  readyCount: number;
  overdueCount: number;
}

export interface WorkflowStep {
  id: string;
  name: string;
  sequence: number;
}

export type CardStage = "ready" | "snoozed" | "completed" | "removed";

export interface WorkflowCard {
  id: string;
  personId: string;
  person: Person;
  stepId: string | null; // null once completed
  stage: CardStage;
  assigneeName: string | null;
  overdue: boolean;
  movedToStepAt: string;
  createdAt: string;
  snoozeUntil: string | null;
  noteCount: number;
}

export interface Board {
  workflow: { id: string; name: string };
  steps: WorkflowStep[];
  cards: WorkflowCard[];
}

export type NoteSource = "card" | "profile" | "internal";

export interface Note {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  source: NoteSource;
  category: string | null;
}

/* ───────────── Services ───────────── */

export interface ServiceType {
  id: string;
  name: string;
}

export interface PlanSummary {
  id: string;
  serviceTypeId: string;
  serviceTypeName: string;
  title: string;
  seriesTitle: string | null;
  dates: string; // human string from PCO, e.g. "October 4, 2026"
  sortDate: string; // ISO
  neededCount: number;
  /** null in the fast upcoming-plans list; loaded separately (PlanCounts) when shown. */
  confirmedCount: number | null;
  unconfirmedCount: number | null;
  declinedCount: number | null;
}

export interface PlanCounts {
  confirmed: number;
  unconfirmed: number;
  declined: number;
}

export interface PlanTime {
  id: string;
  name: string;
  kind: "service" | "rehearsal" | "other";
  startsAt: string;
  endsAt: string;
}

export interface PlanItem {
  id: string;
  title: string;
  sequence: number;
  kind: "song" | "header" | "media" | "item";
  lengthSec: number;
  description: string | null;
  songKey: string | null;
  servicePosition: "pre" | "during" | "post";
  notes: { id?: string; categoryId?: string | null; category: string; body: string }[];
  /** Songs: the catalog song, arrangement and key chosen for this item. */
  songId?: string | null;
  arrangementId?: string | null;
  keyId?: string | null;
}

export type RosterStatus = "C" | "U" | "D";

export interface TeamMember {
  id: string; // PlanPerson id
  personId: string;
  name: string;
  avatarUrl: string | null;
  teamId: string;
  teamName: string;
  positionName: string;
  status: RosterStatus;
  declineReason: string | null;
  notifiedAt: string | null;
}

export interface NeededPosition {
  id: string;
  teamId: string;
  teamName: string;
  positionName: string;
  quantity: number;
}

export interface Team {
  id: string;
  name: string;
  positions: { id: string; name: string }[];
}

export interface PlanDetail extends PlanSummary {
  confirmedCount: number;
  unconfirmedCount: number;
  declinedCount: number;
  times: PlanTime[];
  items: PlanItem[];
  roster: TeamMember[];
  needed: NeededPosition[];
  teams: Team[];
}

export type ConflictKind = "blockout" | "double_booked" | "same_plan";

export interface Conflict {
  kind: ConflictKind;
  label: string;
}

export interface Candidate {
  personId: string;
  name: string;
  avatarUrl: string | null;
  conflicts: Conflict[];
  lastServed: string | null;
  /** false = only checked against this plan so far; blockouts/other services load separately. */
  checked: boolean;
}

export interface ScheduleRequest {
  personId: string;
  teamId: string;
  positionName: string;
  notify: boolean;
}

/* ───────────── Mics & packs (Shure) ───────────── */

export type ShureModel = "ULXD" | "QLXD" | "SLXD" | "AD";

export interface Receiver {
  id: string;
  name: string; // e.g. "Rack A"
  model: ShureModel;
  ip: string; // blank = assign only, don't send names
  channels: number; // 1, 2 or 4
}

export type MicKind = "vocal" | "pack" | "other";

export interface MicChannel {
  id: string;
  label: string; // e.g. "Vox 1", "AG Pack"
  kind: MicKind;
  receiverId: string | null;
  channel: number; // 1-based channel on the receiver
  /** Positions this mic is for, used by Auto-assign (e.g. ["Worship Leader"], ["Vocals"]). */
  positions: string[];
  /**
   * Allen & Heath console inputs that get this mic's name (dLive / Avantis). Empty or missing: not
   * sent. Two inputs = a double patch (e.g. a second input for in-ears).
   */
  consoleInputs?: number[];
}

export interface MicSetup {
  receivers: Receiver[];
  channels: MicChannel[];
}

/** Live status of one receiver channel, read from the receiver (never written). */
export interface ChannelStatus {
  channel: number;
  name: string | null; // channel name currently on the receiver
  txOn: boolean; // a transmitter is linked and on
  txModel: string | null; // e.g. ULXD2, AD1
  batteryBars: number | null; // 0–5
  batteryMinutes: number | null; // runtime left (Shure rechargeables)
  batteryPercent: number | null;
  batteryType: string | null; // LION, ALKA, NIMH, LITH
  frequencyMHz: number | null;
  antennas: string | null; // one letter per antenna: A/B (or R/B on Axient) = active, X = off
  rfDbm: number | null; // strongest antenna, dBm
  interference: boolean;
  muted: boolean | null;
}

export interface ReceiverStatus {
  receiverId: string;
  ok: boolean;
  error?: string;
  channels: ChannelStatus[];
  at: string;
}

export interface MicAssignment {
  channelId: string;
  personId: string;
  name: string;
}

export interface PlanMics {
  planId: string;
  assignments: MicAssignment[];
  /** "<kind>:<personId>" → channelId they used last time (Auto-assign keeps people on "their" mic). */
  usual: Record<string, string>;
}


/** A campus: a name and the service types that belong to it. */
export interface Campus { id: string; name: string; serviceTypeIds: string[] }
export interface CampusSettings { campuses: Campus[]; /** This person's default campus (null = all). */ myDefault: string | null }

/** Allen & Heath dLive / Avantis connection (Preferences → Audio). */
export interface ConsoleSettingsView { enabled: boolean; model: "dlive" | "avantis"; host: string; port: number; midiChannel: number }
/** What "Send names to console" writes: each mic's name to its input(s). */
export interface ConsolePreview {
  rows: { micId: string; micLabel: string; inputs: number[]; person: string | null; name: string }[];
  sent?: number;
}

/* ───────────── Settings ───────────── */

export type ThemePref = "dark" | "light" | "system";

export type StartView =
  | { kind: "dashboard" }
  | { kind: "propresenter" }
  | { kind: "paging" }
  | { kind: "next-runsheet"; serviceTypeId: string | null }
  | { kind: "workflows" }
  | { kind: "workflow"; workflowId: string }
  | { kind: "services" }
  | { kind: "next-service"; serviceTypeId: string | null }
  | { kind: "next-checkins"; serviceTypeId: string | null };


/**
 * The keys that get their own snapshot. F# and Gb are separate; C#, D#, G# and A# aren't used, so a
 * song in one of those uses its flat (C# → Db, D# → Eb, G# → Ab, A# → Bb).
 */
export const KEY_ROOTS = ["C", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
export type KeyRoot = (typeof KEY_ROOTS)[number];

/** Extra Tuning buttons that recall a snapshot of their own. */
export const TUNING_EXTRAS = [
  { id: "CHROMATIC", label: "Chromatic Tune", short: "Chromatic" },
  { id: "OFF", label: "Tuning Off", short: "Off" },
] as const;
export type TuningExtraId = (typeof TUNING_EXTRAS)[number]["id"];

/**
 * Waves SuperRack over MIDI. SuperRack recalls snapshot N from Bank LSB (CC 32) = floor((N-1)/128)
 * followed by Program Change (N-1) % 128. Each key is mapped to the snapshot that sets it up.
 */
export interface WavesSettings {
  enabled: boolean;
  /** MIDI output name on this Mac, e.g. "IAC Driver Bus 1" or "Network Session 1". */
  output: string | null;
  channel: number; // 1–16
  /** Key ("C", "Db" … "B") or Tuning button ("CHROMATIC", "OFF") → SuperRack snapshot (its External ID, 0–999). */
  snapshots: Record<string, number | null>;
  /**
   * How a number turns into Bank LSB + Program Change:
   *  - "externalId" (default): SuperRack's External ID, 125 per bank: ID = bank × 125 + program.
   *  - "program": plain snapshot numbers from 1, 128 per bank: n = bank × 128 + program + 1.
   */
  numbering?: "externalId" | "program";
  /** Song items whose titles are here aren't on the Tuning bar (e.g. "Vocal Warm Ups"). */
  hideFromTuning?: string[];
}

export interface AppSettings {
  theme: ThemePref;
  /** Custom logo as a data: URL (PNG, JPG or SVG), shown in the sidebar and on the sign-in page. */
  logo: string | null;
  startView: StartView;
  waves: WavesSettings;
}

/* ───────────── Check-ins ───────────── */

export type CheckInKind = "Regular" | "Guest" | "Volunteer";

export interface CheckInRow {
  id: string;
  personId: string | null;
  name: string;
  avatarUrl: string | null;
  kind: CheckInKind;
  event: string;
  locations: string[];
  /** Check-Ins location ids (rooms), for matching a ministry's rooms. */
  locationIds: string[];
  at: string; // checked in
  checkedOutAt: string | null;
  securityCode: string | null;
}

export interface CheckInsForPlan {
  from: string;
  to: string;
  rows: CheckInRow[];
  fetchedAt: string;
}

/* ───────────── Stage plots ───────────── */

export type PlotItemType =
  | "vocal" | "mic" | "di" | "wedge" | "iem" | "amp" | "keys" | "drums"
  | "acoustic" | "electric" | "bass" | "person" | "power" | "riser" | "label";

/** What an item shows on a given Sunday: the person on a mic channel, or whoever's in a position. */
export type PlotLink = { kind: "mic"; channelId: string } | { kind: "position"; position: string } | null;

export interface PlotItem {
  id: string;
  type: PlotItemType;
  x: number; // 0–1 across the stage (centre of the item)
  y: number; // 0–1 down the stage
  w?: number; // risers and labels: 0–1 width
  h?: number; // risers: 0–1 height
  rotation: number; // degrees
  label: string;
  link: PlotLink;
  /** Card fill color (hex). Text switches between dark and light automatically. */
  color?: string;
  /** Card corner radius in px. */
  radius?: number;
}

/** Who a stage-plot card shows on a given service. */
export interface PlotPerson {
  name: string;
  position: string;
  mics: string[]; // mic labels assigned to them this service, e.g. ["Vox 2", "AG Pack"]
}

export interface StagePlot {
  id: string;
  name: string;
  /** Used by default for this service type's services. */
  serviceTypeId: string | null;
  /** Background image (a PDF page is converted to an image when it's added). */
  background: { fileId: string; width: number; height: number; source: string } | null;
  items: PlotItem[];
  updatedAt: string;
}

/* ───────────── Parent paging (ProPresenter messages) ───────────── */

export type Ministry = "nursery" | "kids";
export const MINISTRIES: Ministry[] = ["nursery", "kids"];

/** ProPresenter's way of naming things: any of uuid, name or index identifies it. */
export interface ProId { uuid: string; name: string; index: number }

export interface ProPresenterMachine {
  host: string;
  port: number;
  /** "Main sanctuary Pro7 machine" */
  name: string;
  /** "ProPresenter 7.14" */
  version: string;
  platform: string;
}

/** A theme slide that a message can use, e.g. "Nursery › Lower third". */
export interface ProThemeOption { id: ProId; theme: string; slide: string; label: string }

/** An existing ProPresenter message and its text tokens. */
export interface ProMessageOption { id: ProId; message: string; tokens: string[] }

export interface MinistryPaging {
  enabled: boolean;
  /** Shown on the iPad page, e.g. "Nursery". */
  title: string;
  /** Check-Ins rooms whose children appear on this ministry's iPad page. */
  locationIds: string[];
  /**
   * "managed": Cool Services keeps its own ProPresenter message ("Cool Services · Nursery") with
   * the text and theme below. "existing": trigger a message you already have in ProPresenter.
   */
  mode: "managed" | "existing";
  /** Managed: the message text; {code} becomes the child's security code. */
  text: string;
  /** Managed: the theme slide the message uses. */
  theme: ProId | null;
  /** Existing: which message, and which of its text tokens gets the code. */
  existing: { id: ProId; token: string } | null;
  /** A PIN is set (the PIN itself is never sent to the app). */
  hasPin: boolean;
}

export interface PagingConfig {
  propresenter: { host: string; port: number };
  /** How long a page stays on screen. Nobody can page again until it's gone (default 15s). */
  onScreenSeconds: number;
  /** iPad pages on the church network. */
  /**
   * hostnames: optional friendly addresses (e.g. kids.libertychurch.net) that point at this Mac in the
   * church's DNS. Opening one goes straight to that ministry's page.
   */
  ipads: { enabled: boolean; port: number; hostnames?: Partial<Record<Ministry, string>> };
  ministries: Record<Ministry, MinistryPaging>;
  /**
   * Hold iPad pages until someone sends them from Cool Services (a banner shows each request).
   * Off: iPads put codes straight on the screens.
   */
  approval: boolean;
}

/** A page an iPad asked for, waiting for the production team to send it. */
export interface PageRequest {
  id: string;
  ministry: Ministry;
  code: string;
  childName: string | null;
  by: string;
  requestedAt: string;
  /** waiting → (sent | cancelled); "released" = sent from Cool Services, goes up as soon as the screen is free. */
  state: "waiting" | "released" | "sent" | "cancelled" | "failed";
  doneAt?: string;
  error?: string;
}

/** Settings → iPad addresses for each ministry. */
export interface KioskAddresses {
  urls: string[]; port: number; running: boolean; error?: string;
  /** Friendly address per ministry, e.g. { kids: "http://kids.libertychurch.net" }. */
  friendly: Partial<Record<Ministry, string>>;
}

export interface PageEvent {
  id: string;
  ministry: Ministry;
  code: string;
  childName: string | null;
  by: string; // "Nursery iPad" or a staff name
  at: string;
  ok: boolean;
  error?: string;
}

export interface PagingStatus {
  configured: boolean;
  /** A page is on screen until this time; paging is locked until then. */
  onScreenUntil: string | null;
  current: PageEvent | null;
  recent: PageEvent[];
  /** Today's page requests from the iPads (when pages need approval). */
  requests: PageRequest[];
  approval: boolean;
  serverTime: string;
}

/** A child on a ministry's iPad page. */
export interface KioskChild {
  id: string; // check-in id
  name: string;
  avatarUrl: string | null;
  securityCode: string | null;
  room: string;
  at: string;
  guest: boolean;
}

export interface KioskInfo {
  ministry: Ministry;
  title: string;
  church: string;
  logo: string | null;
  unlocked: boolean;
  enabled: boolean;
  /** Pages go to the production team first (the iPad "requests" a page). */
  approval: boolean;
}

export interface KioskChildren { children: KioskChild[]; fetchedAt: string }

export interface CheckInLocation { id: string; name: string; event: string; folder: string | null; childOrAdult: string | null }

/* ───────────── Matrix (several weeks of one service type) ───────────── */

export interface Matrix {
  serviceType: ServiceType;
  /** Oldest first: any past weeks asked for, then the upcoming ones. */
  plans: PlanDetail[];
}

/* ───────────── Full run sheet ───────────── */

/** Planning Center Live for a plan: where the service is right now. */
export interface RunSheetLive {
  currentItemId: string | null;
  nextItemId: string | null;
  /** When the current item started (live_start_at). */
  currentStartedAt: string | null;
  controller: string | null;
  /** You're the one driving Live. */
  youControl?: boolean;
  /** You're allowed to take over Live. */
  canTakeControl?: boolean;
}

/** An operator view of the full run sheet: which Planning Center note categories show, in what order. */
export interface RunSheetView {
  id: string;
  name: string;
  /** Item note categories shown as columns, in this order. */
  categories: string[];
  /** Emphasize items that have notes in this category. */
  highlight: string | null;
  /** Plan-wide note categories shown at the top (null = all). */
  planNotes: string[] | null;
  showDescriptions: boolean;
}

export interface NoteCategory { id: string; name: string }

/** Actual Live times: item id → plan time id → when it started/ended. */
export type ItemTimes = Record<string, Record<string, { start: string | null; end: string | null }>>;

export interface SongHit { id: string; title: string; author: string | null; lastScheduledAt: string | null }
export interface SongArrangement { id: string; name: string; lengthSec: number; keys: { id: string; name: string; startingKey: string | null }[] }

/** Add or change a run sheet item in Planning Center. */
export interface ItemInput {
  kind?: "song" | "header" | "media" | "item";
  title?: string;
  lengthSec?: number;
  description?: string | null;
  servicePosition?: "pre" | "during" | "post";
  songId?: string | null;
  arrangementId?: string | null;
  keyId?: string | null;
  /** New items: put right after this item (null = at the top; omitted = at the end). */
  afterItemId?: string | null;
}

export interface RunSheetData {
  plan: PlanDetail;
  /** Plan-wide notes (e.g. "Version"). */
  planNotes: { category: string; body: string }[];
  fetchedAt: string;
}

/* ───────────── ProPresenter control (side screens computer, etc.) ───────────── */

export interface ProMachine { id: string; name: string; host: string; port: number; /** "paging" is the Kids & Nursery one from Settings. */ builtIn?: boolean }

export interface ProSlide { index: number; group: string; groupColor: string | null; label: string; text: string; enabled: boolean }

export interface ProTimer {
  id: ProId;
  /** "00:04:32" as ProPresenter shows it (may start with "-" when over). */
  time: string;
  state: "stopped" | "running" | "complete" | "overrunning" | "overran" | string;
  kind: "countdown" | "count_down_to_time" | "elapsed" | "unknown";
  /** Countdown length in seconds. */
  duration: number | null;
  allowsOverrun: boolean;
}

export interface ProControlState {
  ok: boolean;
  error?: string;
  name?: string;
  version?: string;
  presentation: { uuid: string; name: string; slides: ProSlide[] } | null;
  slideIndex: number | null;
  current: { text: string; notes: string } | null;
  next: { text: string; notes: string } | null;
  timers: ProTimer[];
  stageMessage: string;
  stageScreens: { id: ProId; layout: ProId | null }[];
  stageLayouts: ProId[];
  clearGroups: ProId[];
  looks: ProId[];
  at: string;
}

export type ProAction =
  | { type: "next" } | { type: "previous" }
  | { type: "trigger"; uuid: string; index: number }
  | { type: "clear"; layer: "slide" | "media" | "props" | "messages" | "announcements" | "audio" | "video_input" | "all" }
  | { type: "clearGroup"; id: string }
  | { type: "look"; id: string }
  | { type: "timer"; id: string; op: "start" | "stop" | "reset" }
  | { type: "timerSet"; id: string; duration: number; allowsOverrun?: boolean }
  | { type: "timerAdd"; id: string; seconds: number }
  | { type: "stageMessage"; text: string | null }
  | { type: "stageLayout"; screen: string; layout: string };

/* ───────────── Smaart SPL + dashboard ───────────── */

export interface SmaartSettingsView { enabled: boolean; host: string; port: number; path: string; limit: number; hasPassword: boolean }
export interface SmaartStatusView {
  state: "off" | "connecting" | "connected" | "error";
  error: string | null;
  readings: { key: string; label: string; value: number; approx?: boolean }[];
  at: string | null;
  measurements: { name: string; endpoint: string; active: boolean; stream: "off" | "connecting" | "open" | "error"; messages: number }[];
  sample: string[];
}

/** The service the dashboard follows: a service type (your campus), optionally pinned to one plan. */
export interface HomeService { serviceTypeId: string | null; planId: string | null }

export type WidgetType = "tuning" | "spl" | "wireless" | "live" | "clock" | "pro";
export interface DashboardWidget {
  id: string;
  type: WidgetType;
  /** s = 1 column, m = 2, l = full width. */
  size: "s" | "m" | "l";
  options: Record<string, string | number | boolean | null>;
}
