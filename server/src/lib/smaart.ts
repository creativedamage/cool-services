/**
 * Smaart v9 SPL, read over Smaart's API (Options → API in Smaart; default port 26000).
 *
 * The API is JSON over a WebSocket (ws://<computer>:26000/api/v3/): { sequenceNumber, action:
 * "get" | "set", target?, properties? }. If Smaart has an API password it answers the first "get"
 * with authenticationRequired, and we send the password.
 *
 * Rational Acoustics shares the full command list on request, so this reads SPL defensively: it asks
 * for the likely meter targets and picks out every SPL-looking value in what Smaart sends back
 * (LAeq, dBA slow, LCeq, peak…). Settings shows exactly what came back, so the right reading can be
 * chosen, and anything unexpected can be sent to us to add.
 */
export interface SmaartConfig { enabled: boolean; host: string; port: number; password: string; path: string; limit: number }
export interface SmaartReading { key: string; label: string; value: number }
export interface SmaartStatus {
  state: "off" | "connecting" | "connected" | "error";
  error: string | null;
  readings: SmaartReading[];
  at: string | null;
  /** The last few messages from Smaart (trimmed), to help set things up. */
  sample: string[];
}

const CANDIDATE_TARGETS = ["splMeters", "splMeter", "spl", "splLogging", "splHistory", "meters", "inputMeters", "activeMeasurements"];
const SPL_KEY = /(spl|leq|laeq|lceq|lzeq|la(s|f)|lc(s|f)|dba|dbc|dbz|slow|fast|peak|level|exposure)/i;

let cfg: SmaartConfig | null = null;
let ws: WebSocket | null = null;
let seq = 2;
let timer: NodeJS.Timeout | null = null;
let retry: NodeJS.Timeout | null = null;
let goodTargets = new Set<string>(["(none)"]);
const readings = new Map<string, SmaartReading>();
const status: SmaartStatus = { state: "off", error: null, readings: [], at: null, sample: [] };

export const smaartStatus = (): SmaartStatus => ({ ...status, readings: [...readings.values()].sort((a, b) => a.label.localeCompare(b.label)) });

function send(o: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ sequenceNumber: seq = seq < 0xffff ? seq + 1 : 2, ...o }));
}

/** Walk anything Smaart sends and keep numbers whose names look like SPL readings. */
function harvest(o: unknown, trail: string[] = [], name = "") {
  if (Array.isArray(o)) { o.forEach((x, i) => harvest(x, [...trail, String(i)], name)); return; }
  if (!o || typeof o !== "object") return;
  const obj = o as Record<string, unknown>;
  const here = typeof obj.name === "string" ? obj.name : typeof obj.measurementName === "string" ? obj.measurementName : name;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number" && SPL_KEY.test(k) && v > 0 && v < 200) {
      const key = [...trail, k].join(".");
      readings.set(key, { key, label: `${here ? `${here} · ` : ""}${k}`, value: Math.round(v * 10) / 10 });
    } else if (typeof v === "object") harvest(v, [...trail, k], here);
  }
}

function onMessage(text: string) {
  status.sample = [text.slice(0, 600), ...status.sample].slice(0, 5);
  let m: { sequenceNumber?: number; response?: { error?: string; authenticationRequired?: boolean }; target?: unknown } & Record<string, unknown>;
  try { m = JSON.parse(text); } catch { return; }
  if (m.response?.authenticationRequired && cfg?.password) { send({ action: "set", properties: [{ password: cfg.password }] }); return; }
  if (m.response?.authenticationRequired) { status.state = "error"; status.error = "Smaart asks for a password. Add it in Settings."; return; }
  if (m.response?.error) {
    if (/unknown target/i.test(m.response.error) && typeof m.target === "string") goodTargets.delete(m.target);
    return;
  }
  const before = readings.size;
  harvest(m);
  if (readings.size || before) { status.at = new Date().toISOString(); }
  status.state = "connected"; status.error = null;
}

function stop() {
  if (timer) clearInterval(timer);
  if (retry) clearTimeout(retry);
  timer = retry = null;
  try { ws?.close(); } catch { /* ignore */ }
  ws = null;
}

export function applySmaart(next: SmaartConfig) {
  cfg = next;
  stop();
  readings.clear();
  status.sample = [];
  if (!next.enabled || !next.host) { status.state = "off"; status.error = null; return; }
  status.state = "connecting"; status.error = null;
  const url = `ws://${next.host}:${next.port || 26000}${next.path?.startsWith("/") ? next.path : `/${next.path || "api/v3/"}`}`;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    status.state = "error"; status.error = (e as Error).message;
    return;
  }
  goodTargets = new Set(CANDIDATE_TARGETS);
  ws.onopen = () => {
    send({ action: "get" });
    for (const t of CANDIDATE_TARGETS) send({ action: "get", target: t });
    // Keep asking once a second for whatever meter targets Smaart recognised.
    timer = setInterval(() => { send({ action: "get" }); for (const t of goodTargets) send({ action: "get", target: t }); }, 1000);
  };
  ws.onmessage = (e) => onMessage(typeof e.data === "string" ? e.data : Buffer.from(e.data as ArrayBuffer).toString("utf8"));
  ws.onerror = () => { status.state = "error"; status.error = `Can’t connect to Smaart at ${url}. Is Smaart open with Options → API turned on?`; };
  ws.onclose = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (cfg?.enabled) { if (status.state !== "error") status.state = "connecting"; retry = setTimeout(() => cfg && applySmaart(cfg), 5000); }
  };
}
