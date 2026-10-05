/**
 * Smaart v9 SPL, read over Smaart's API (Options → Preferences → API; default port 26000).
 *
 * The API is JSON over a WebSocket (ws://<computer>:26000/api/v4/): { sequenceNumber, action:
 * "get" | "set", target?, properties? }. If Smaart has an API password it answers with
 * authenticationRequired, and we send the password.
 *
 * Smaart v9 answers a plain "get" with its measurements, each with a streamEndpoint
 * (e.g. /api/v4/measurements/RTA%20MIC). Live data comes over a second WebSocket opened on that
 * endpoint. Rational Acoustics shares the full data format on request only, so this reads it
 * defensively:
 *  - every SPL-looking number anywhere in what Smaart sends (LAeq, dBA slow, LCeq, peak…);
 *  - failing that, the overall level worked out from a measurement's spectrum (approximate).
 * Settings shows what Smaart sent, so the format can be matched exactly.
 */
export interface SmaartConfig { enabled: boolean; host: string; port: number; password: string; path: string; limit: number }
export interface SmaartReading { key: string; label: string; value: number; approx?: boolean }
export interface SmaartStatus {
  state: "off" | "connecting" | "connected" | "error";
  error: string | null;
  readings: SmaartReading[];
  at: string | null;
  /** Measurements Smaart told us about, and whether their data stream is open. */
  measurements: { name: string; endpoint: string; active: boolean; stream: "off" | "connecting" | "open" | "error"; messages: number }[];
  /** The last few (different) messages from Smaart, trimmed, to help set things up. */
  sample: string[];
}

/** Targets Smaart might know for SPL. Each is asked once; any Smaart doesn't know is dropped. */
const CANDIDATE_TARGETS = ["splMeters", "splMeter", "spl", "splLogging", "splHistory", "meters", "inputMeters"];
const SPL_KEY = /(spl|leq|laeq|lceq|lzeq|la(s|f)|lc(s|f)|dba|dbc|dbz|slow|fast|peak|level|exposure)/i;
const SPECTRUM_KEY = /(magnitude|spectrum|rta|data|values|levels|amplitude|power|bins|db)/i;
const FREQ_KEY = /(freq|frequenc|hz|bins?x|xaxis)/i;

let cfg: SmaartConfig | null = null;
let ws: WebSocket | null = null;
let seq = 2;
let timer: NodeJS.Timeout | null = null;
let retry: NodeJS.Timeout | null = null;
const pending = new Map<number, string>(); // sequenceNumber → target asked for
let targets = new Set<string>();
const streams = new Map<string, { ws: WebSocket | null; name: string; endpoint: string; active: boolean; state: SmaartStatus["measurements"][number]["stream"]; messages: number; retry: NodeJS.Timeout | null; seq: number }>();
const readings = new Map<string, SmaartReading & { t: number }>();
const status: Omit<SmaartStatus, "measurements" | "readings"> = { state: "off", error: null, at: null, sample: [] };

export const smaartStatus = (): SmaartStatus => {
  const fresh = Date.now() - 60_000;
  return {
    ...status,
    readings: [...readings.values()].filter((r) => r.t > fresh).map(({ t: _t, ...r }) => r).sort((a, b) => Number(a.approx ?? 0) - Number(b.approx ?? 0) || a.label.localeCompare(b.label)),
    measurements: [...streams.values()].map((s) => ({ name: s.name, endpoint: s.endpoint, active: s.active, stream: s.state, messages: s.messages })),
  };
};

const toText = (d: unknown) => (typeof d === "string" ? d : Buffer.from(d as ArrayBuffer).toString("utf8"));
const base = () => `ws://${cfg!.host}:${cfg!.port || 26000}`;

function note(text: string) {
  // Keep a handful of different-looking messages (not 5 copies of the same error).
  const shape = text.replace(/\d+(\.\d+)?/g, "#").slice(0, 200);
  if (status.sample.some((s) => s.replace(/\d+(\.\d+)?/g, "#").slice(0, 200) === shape)) return;
  status.sample = [text.slice(0, 1200), ...status.sample].slice(0, 8);
}

function set(key: string, label: string, value: number, approx = false) {
  readings.set(key, { key, label, value: Math.round(value * 10) / 10, approx, t: Date.now() });
  status.at = new Date().toISOString();
}

const LABEL_KEYS = ["name", "label", "metric", "type", "title", "id", "meter", "description", "displayName"];
const VALUE_KEYS = ["value", "level", "current", "reading", "val", "db", "dB", "spl", "result", "data", "number"];
const TEXT_READING = /\b(L[ACZ](?:eq|S|F|peak|max|min)?(?:\s*\d+\s*(?:s|m|min|h))?|dB[ACZ]?(?:\s*(?:slow|fast))?|SPL|Leq)\b[^\d-]{0,12}(\d{2,3}(?:\.\d+)?)/i;

/** Walk anything Smaart sends and keep numbers that look like SPL readings. */
function harvest(o: unknown, trail: string[], name: string) {
  if (Array.isArray(o)) { o.forEach((x, i) => harvest(x, [...trail, String(i)], name)); return; }
  if (typeof o === "string") {
    // "LAeq 1m: 92.4 dB", "dBA Slow 88.1"
    const m = o.match(TEXT_READING);
    if (m) { const v = Number(m[2]); if (v > 20 && v < 160) set([...trail, m[1]].join("."), `${name ? `${name} · ` : ""}${m[1]}`, v); }
    return;
  }
  if (!o || typeof o !== "object") return;
  const obj = o as Record<string, unknown>;
  const here = typeof obj.name === "string" ? obj.name : typeof obj.measurementName === "string" ? obj.measurementName : name;
  // { name: "LAeq 10m", value: 92.3 } and the like: the label says SPL, the number sits under "value".
  const labelKey = LABEL_KEYS.find((k) => typeof obj[k] === "string" && SPL_KEY.test(obj[k] as string));
  const valueKey = VALUE_KEYS.find((k) => typeof obj[k] === "number" && (obj[k] as number) > 20 && (obj[k] as number) < 160);
  if (labelKey && valueKey) {
    const label = String(obj[labelKey]);
    set([...trail, label].join("."), `${name && name !== label ? `${name} · ` : ""}${label}`, obj[valueKey] as number);
  }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number" && SPL_KEY.test(k) && v > 20 && v < 160) set([...trail, k].join("."), `${here ? `${here} · ` : ""}${k}`, v);
    else if (v && typeof v === "object" && !(Array.isArray(v) && typeof v[0] === "number")) harvest(v, [...trail, k], here);
    else if (typeof v === "string" && v.length < 200) harvest(v, [...trail, k], here);
  }
}

/** A-weighting in dB at frequency f (IEC 61672). */
function aWeight(f: number) {
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return 20 * Math.log10(ra) + 2.0;
}

/**
 * No SPL numbers? Work out the overall level from the spectrum: the energy sum of the bands (Z),
 * and A-weighted when frequencies are sent too. Only makes sense if Smaart's input is calibrated
 * (values in dB SPL), so it's only kept when it lands in a plausible range, and marked approximate.
 */
function fromSpectrum(o: unknown, name: string, key: string, depth = 0): boolean {
  if (!o || typeof o !== "object" || depth > 6) return false;
  const obj = o as Record<string, unknown>;
  const nums = (v: unknown) => Array.isArray(v) && v.length >= 16 && v.every((x) => typeof x === "number") ? (v as number[]) : null;
  let mags: number[] | null = null, freqs: number[] | null = null;
  for (const [k, v] of Object.entries(obj)) {
    const a = nums(v);
    if (!a) continue;
    if (FREQ_KEY.test(k) && a[a.length - 1] > 1000) freqs = a;
    else if (SPECTRUM_KEY.test(k) || !mags) mags = a;
  }
  // Arrays of [freq, dB] pairs, or {frequency, magnitude} points.
  if (!mags) {
    for (const v of Object.values(obj)) {
      if (!Array.isArray(v) || v.length < 16) continue;
      if (v.every((p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number")) {
        freqs = v.map((p) => p[0]); mags = v.map((p) => p[1]); break;
      }
      if (v.every((p) => p && typeof p === "object" && !Array.isArray(p))) {
        const ks = Object.keys(v[0] as object);
        const fk = ks.find((k) => FREQ_KEY.test(k)), mk = ks.find((k) => k !== fk && SPECTRUM_KEY.test(k));
        if (fk && mk && v.every((p) => typeof (p as Record<string, unknown>)[fk] === "number" && typeof (p as Record<string, unknown>)[mk] === "number")) {
          freqs = v.map((p) => (p as Record<string, number>)[fk]); mags = v.map((p) => (p as Record<string, number>)[mk]); break;
        }
      }
    }
  }
  if (mags && (!freqs || freqs.length === mags.length)) {
    const sum = (w: (i: number) => number) => 10 * Math.log10(mags!.reduce((n, db, i) => n + (Number.isFinite(db) ? 10 ** ((db + w(i)) / 10) : 0), 0));
    const z = sum(() => 0);
    if (z > 30 && z < 150) {
      set(`${key}.dBZ`, `${name} · level from spectrum (dBZ)`, z, true);
      if (freqs) {
        const a = sum((i) => (freqs![i] > 0 ? aWeight(freqs![i]) : -200));
        if (a > 20 && a < 150) set(`${key}.dBA`, `${name} · level from spectrum (dBA)`, a, true);
      }
      return true;
    }
  }
  for (const [k, v] of Object.entries(obj)) if (v && typeof v === "object" && !Array.isArray(v) && fromSpectrum(v, name, `${key}.${k}`, depth + 1)) return true;
  if (Array.isArray(obj)) return false;
  return false;
}

/** Measurements listed anywhere in a message: { measurementName, streamEndpoint, active }. */
function findMeasurements(o: unknown, out: { name: string; endpoint: string; active: boolean }[] = []) {
  if (Array.isArray(o)) { o.forEach((x) => findMeasurements(x, out)); return out; }
  if (!o || typeof o !== "object") return out;
  const obj = o as Record<string, unknown>;
  if (typeof obj.streamEndpoint === "string") {
    out.push({ name: String(obj.measurementName ?? obj.name ?? obj.streamEndpoint), endpoint: obj.streamEndpoint, active: obj.active !== false });
  }
  for (const v of Object.values(obj)) if (v && typeof v === "object") findMeasurements(v, out);
  return out;
}

function send(sock: WebSocket | null, o: Record<string, unknown>) {
  if (sock?.readyState !== WebSocket.OPEN) return;
  seq = seq < 0xffff ? seq + 1 : 2;
  if (typeof o.target === "string") pending.set(seq, o.target);
  sock.send(JSON.stringify({ sequenceNumber: seq, ...o }));
}

type Msg = { sequenceNumber?: number; response?: Record<string, unknown> & { error?: string; authenticationRequired?: boolean } } & Record<string, unknown>;

/** Handle auth prompts; returns true when the message was about auth. */
function auth(sock: WebSocket, m: Msg): boolean {
  if (!m.response?.authenticationRequired) return false;
  if (cfg?.password) send(sock, { action: "set", properties: [{ password: cfg.password }] });
  else { status.state = "error"; status.error = "Smaart asks for a password. Add it in Settings."; }
  return true;
}

function onControl(text: string) {
  let m: Msg;
  try { m = JSON.parse(text); } catch { note(text); return; }
  if (auth(ws!, m)) return;
  const asked = m.sequenceNumber != null ? pending.get(m.sequenceNumber) : undefined;
  if (m.sequenceNumber != null) pending.delete(m.sequenceNumber);
  if (m.response?.error) {
    // Smaart doesn't say which target it didn't know; we remember what each request asked for.
    if (/unknown target/i.test(m.response.error) && asked) targets.delete(asked);
    else note(text);
    status.state = "connected"; status.error = null;
    return;
  }
  note(text);
  status.state = "connected"; status.error = null;
  harvest(m, asked ? [asked] : [], "");
  for (const found of findMeasurements(m)) openStream(found);
}

/**
 * Binary frames: Smaart's streams may send raw 32-bit floats (little-endian). A few numbers in the
 * SPL range are meter values; a long run is a spectrum (dB per band), summed to an overall level.
 */
function binary(buf: ArrayBuffer, name: string, key: string, n: number) {
  if (buf.byteLength < 4 || buf.byteLength % 4) { if (n <= 3) note(`[${name}] binary ${buf.byteLength} bytes`); return; }
  const f = new Float32Array(buf.slice(0, buf.byteLength - (buf.byteLength % 4)));
  if (n <= 3) note(`[${name}] binary ${f.length} floats: ${[...f.slice(0, 12)].map((x) => x.toFixed(1)).join(", ")}`);
  const vals = [...f].filter(Number.isFinite);
  if (!vals.length) return;
  if (vals.length <= 8) {
    vals.forEach((v, i) => { if (v > 20 && v < 160) set(`${key}.bin${i}`, `${name}${vals.length > 1 ? ` · meter ${i + 1}` : ""}`, v); });
    return;
  }
  fromSpectrum({ magnitude: vals }, name, key);
}

function openStream(found: { name: string; endpoint: string; active: boolean }) {
  const cur = streams.get(found.endpoint);
  if (cur) { cur.active = found.active; cur.name = found.name; return; }
  const st = { ws: null as WebSocket | null, ...found, state: "off" as SmaartStatus["measurements"][number]["stream"], messages: 0, retry: null as NodeJS.Timeout | null, seq: 0 };
  streams.set(found.endpoint, st);
  connectStream(st);
}

function connectStream(st: ReturnType<typeof streams.get> & object) {
  if (!cfg?.enabled) return;
  const path = st.endpoint.startsWith("/") ? st.endpoint : `/${st.endpoint}`;
  st.state = "connecting";
  let sock: WebSocket;
  try { sock = new WebSocket(`${base()}${path}`); } catch { st.state = "error"; return; }
  st.ws = sock;
  const key = `m:${st.name}`;
  sock.onopen = () => {
    st.state = "open";
    send(sock, { action: "get" });
    // Some Smaart builds only send meter values when asked; ask, and keep asking every second.
    for (const t of CANDIDATE_TARGETS) send(sock, { action: "get", target: t });
    const poll = setInterval(() => {
      if (sock.readyState !== WebSocket.OPEN) { clearInterval(poll); return; }
      send(sock, { action: "get" });
    }, 1000);
  };
  sock.binaryType = "arraybuffer";
  sock.onmessage = (e) => {
    st.messages++;
    if (typeof e.data !== "string") { binary(e.data as ArrayBuffer, st.name, key, st.messages); return; }
    const text = toText(e.data);
    let m: Msg;
    try { m = JSON.parse(text); } catch { if (st.messages <= 3) note(`[${st.name}] ${text.slice(0, 300)}`); return; }
    if (auth(sock, m)) return;
    if (st.messages <= 3 || st.messages % 200 === 0) note(`[${st.name}] ${text}`);
    const before = [...readings.keys()].filter((k) => k.startsWith(key) && !readings.get(k)!.approx).length;
    harvest(m, [key], st.name);
    const exact = [...readings.keys()].some((k) => k.startsWith(key) && !readings.get(k)!.approx) || before > 0;
    if (!exact) fromSpectrum(m, st.name, key);
  };
  sock.onerror = () => { st.state = "error"; };
  sock.onclose = () => {
    if (st.ws !== sock) return;
    st.ws = null;
    if (st.state !== "error") st.state = "off";
    if (cfg?.enabled && streams.get(st.endpoint) === st) st.retry = setTimeout(() => connectStream(st), 5000);
  };
}

function stop() {
  if (timer) clearInterval(timer);
  if (retry) clearTimeout(retry);
  timer = retry = null;
  for (const s of streams.values()) { if (s.retry) clearTimeout(s.retry); const w = s.ws; s.ws = null; try { w?.close(); } catch { /* ignore */ } }
  streams.clear();
  pending.clear();
  const w = ws; ws = null;
  try { w?.close(); } catch { /* ignore */ }
}

export function applySmaart(next: SmaartConfig) {
  cfg = next;
  stop();
  readings.clear();
  status.sample = [];
  if (!next.enabled || !next.host) { status.state = "off"; status.error = null; return; }
  status.state = "connecting"; status.error = null;
  const url = `${base()}${next.path?.startsWith("/") ? next.path : `/${next.path || "api/v4/"}`}`;
  let sock: WebSocket;
  try { sock = new WebSocket(url); } catch (e) { status.state = "error"; status.error = (e as Error).message; return; }
  ws = sock;
  targets = new Set(CANDIDATE_TARGETS);
  sock.onopen = () => {
    send(sock, { action: "get" });
    for (const t of targets) send(sock, { action: "get", target: t });
    // Ask again every second for any SPL target Smaart knew, and every 10s for the measurement list
    // (new measurements get their stream opened).
    let n = 0;
    timer = setInterval(() => {
      n++;
      if (n % 10 === 0) send(sock, { action: "get" });
      for (const t of targets) send(sock, { action: "get", target: t });
    }, 1000);
  };
  sock.onmessage = (e) => onControl(toText(e.data));
  sock.onerror = () => { status.state = "error"; status.error = `Can’t connect to Smaart at ${url}. Is Smaart open with Options → Preferences → API turned on?`; };
  sock.onclose = () => {
    if (ws !== sock) return;
    if (timer) clearInterval(timer);
    timer = null;
    if (cfg?.enabled) { if (status.state !== "error") status.state = "connecting"; retry = setTimeout(() => cfg && applySmaart(cfg), 5000); }
  };
}
