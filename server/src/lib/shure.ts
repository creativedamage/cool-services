/**
 * Shure wireless receivers — READ-ONLY live status.
 *
 * ULX-D, QLX-D, SLX-D and Axient Digital answer plain-text questions over TCP port 2202:
 *
 *   < GET 1 BATT_BARS >   →   < REP 1 BATT_BARS 004 >
 *
 * Sundays never changes a receiver: no channel names, no gain, no frequencies, nothing that
 * Wireless Workbench or the receiver would show as changed. Mic assignments stay inside the app.
 *
 * The one non-GET message is METER_RATE on ULX-D-family receivers. It only asks the receiver to
 * report antenna/RF meter readings on this connection for a moment (then turned back off); ULX-D
 * has no GET for those readings. Axient Digital reports antennas and RF with plain GETs.
 */
import net from "node:net";
import type { ChannelStatus, Receiver, ReceiverStatus } from "../../../shared/types.js";

export const SHURE_PORT = 2202;

/** Send messages to one receiver and collect everything it says back until isDone or timeout. */
function talk(ip: string, messages: string[], isDone: (replies: string[]) => boolean, timeoutMs: number, after?: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const replies: string[] = [];
    let buf = "";
    let settled = false;
    const sock = net.createConnection({ host: ip, port: SHURE_PORT });
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (after?.length && !err) sock.end(after.join("")); else sock.destroy();
      err ? reject(err) : resolve(replies);
    };
    const timer = setTimeout(() => (replies.length ? done() : done(new Error(`No answer from ${ip} (port ${SHURE_PORT}). Is it on this network?`))), timeoutMs);
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(messages.join("")));
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const found = buf.match(/<[^>]*>/g) ?? [];
      buf = buf.slice(buf.lastIndexOf(">") + 1);
      replies.push(...found.map((r) => r.trim()));
      if (isDone(replies)) done();
    });
    sock.on("error", (e: NodeJS.ErrnoException) =>
      done(new Error(e.code === "ECONNREFUSED" ? `${ip} refused the connection (is network control on?)`
        : e.code === "EHOSTUNREACH" || e.code === "ENETUNREACH" || e.code === "ETIMEDOUT" ? `Can't reach ${ip} from this Mac` : e.message)),
    );
  });
}

/** Quick connection test: ask for the device ID. */
export async function probe(ip: string): Promise<{ ok: boolean; deviceId?: string; error?: string }> {
  try {
    const reps = await talk(ip, ["< GET DEVICE_ID >"], (r) => r.some((x) => x.includes("DEVICE_ID")), 3000);
    const m = reps.join(" ").match(/DEVICE_ID\s+\{([^}]*)\}/);
    return { ok: true, deviceId: m?.[1].trim() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const ULX_KEYS = ["CHAN_NAME", "BATT_BARS", "BATT_RUN_TIME", "BATT_CHARGE", "BATT_TYPE", "TX_TYPE", "FREQUENCY", "RF_INT_DET", "TX_MUTE_STATUS"];
const AD_KEYS = ["CHAN_NAME", "TX_BATT_BARS", "TX_BATT_MINS", "TX_BATT_CHARGE_PERCENT", "TX_BATT_TYPE", "TX_MODEL", "FREQUENCY", "ANTENNA_STATUS", "RSSI 0", "TX_MUTE_MODE_STATUS"];

const num = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v.trim()) ? Number(v) : null);
const known = (v: string | undefined) => (v && !/^UNKN(OWN)?$/.test(v.trim()) ? v.trim() : null);

/** Read live status for every channel on a receiver. */
export async function readReceiver(rx: Receiver): Promise<ReceiverStatus> {
  const at = new Date().toISOString();
  const ad = rx.model === "AD";
  const chans = Array.from({ length: rx.channels }, (_, i) => i + 1);
  const gets = chans.flatMap((c) => (ad ? AD_KEYS : ULX_KEYS).map((k) => `< GET ${c} ${k} >`));
  // ULX-D family: briefly ask for meter samples to learn which antennas are active and RF level.
  const meterOn = ad ? [] : chans.map((c) => `< SET ${c} METER_RATE 00100 >`);
  const meterOff = ad ? [] : chans.map((c) => `< SET ${c} METER_RATE 00000 >`);

  try {
    const replies = await talk(
      rx.ip,
      [...gets, ...meterOn],
      (r) => chans.every((c) => r.some((x) => x.startsWith(`< ${ad ? "REP" : "SAMPLE"} ${c} ${ad ? "TX_MUTE_MODE_STATUS" : "ALL"}`))),
      3000,
      meterOff,
    );
    return { receiverId: rx.id, ok: true, at, channels: chans.map((c) => parseChannel(c, replies, ad)) };
  } catch (e) {
    return { receiverId: rx.id, ok: false, error: (e as Error).message, at, channels: [] };
  }
}

function parseChannel(c: number, replies: string[], ad: boolean): ChannelStatus {
  const rep = (key: string) => {
    const re = new RegExp(`^<\\s*REP\\s+${c}\\s+${key}\\s+(.*?)\\s*>$`);
    for (const r of replies) { const m = r.match(re); if (m) return m[1]; }
    return undefined;
  };
  const name = rep("CHAN_NAME")?.match(/\{([^}]*)\}/)?.[1].trim() ?? null;
  const freqRaw = num(rep("FREQUENCY"));

  if (ad) {
    const bars = num(rep("TX_BATT_BARS"));
    const mins = num(rep("TX_BATT_MINS"));
    const pct = num(rep("TX_BATT_CHARGE_PERCENT"));
    const model = known(rep("TX_MODEL"));
    const rssi = replies
      .map((r) => r.match(new RegExp(`^<\\s*REP\\s+${c}\\s+RSSI\\s+\\d+\\s+(\\d+)\\s*>$`))?.[1])
      .filter(Boolean).map(Number);
    const batteryBars = bars !== null && bars <= 5 ? bars : null;
    const txOn = Boolean(model) || batteryBars !== null;
    return {
      channel: c, name, txOn, txModel: model,
      batteryBars,
      batteryMinutes: mins !== null && mins <= 65532 ? mins : null,
      batteryPercent: pct !== null && pct <= 100 ? pct : null,
      batteryType: known(rep("TX_BATT_TYPE")),
      frequencyMHz: freqRaw ? freqRaw / 1000 : null,
      antennas: known(rep("ANTENNA_STATUS")),
      rfDbm: txOn && rssi.length ? Math.max(...rssi) - 120 : null,
      interference: false,
      muted: rep("TX_MUTE_MODE_STATUS") ? rep("TX_MUTE_MODE_STATUS") === "MUTE" : null,
    };
  }

  const bars = num(rep("BATT_BARS"));
  const mins = num(rep("BATT_RUN_TIME"));
  const pct = num(rep("BATT_CHARGE"));
  const model = known(rep("TX_TYPE"));
  const sample = replies.map((r) => r.match(new RegExp(`^<\\s*SAMPLE\\s+${c}\\s+ALL\\s+(\\w{2})\\s+(\\d+)\\s+(\\d+)\\s*>$`))).find(Boolean);
  const batteryBars = bars !== null && bars <= 5 ? bars : null;
  const txOn = Boolean(model) || batteryBars !== null;
  const mute = known(rep("TX_MUTE_STATUS"));
  return {
    channel: c, name, txOn, txModel: model,
    batteryBars,
    batteryMinutes: mins !== null && mins < 65535 ? mins : null,
    batteryPercent: pct !== null && pct <= 100 ? pct : null,
    batteryType: known(rep("BATT_TYPE")),
    frequencyMHz: freqRaw ? freqRaw / 1000 : null,
    antennas: sample ? sample[1] : null,
    rfDbm: txOn && sample ? Number(sample[2]) - 128 : null,
    audioLevel: txOn && sample ? Math.min(50, Number(sample[3])) : null,
    interference: rep("RF_INT_DET") === "CRITICAL",
    muted: mute ? mute === "ON" : null,
  };
}
