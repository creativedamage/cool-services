/**
 * ProPresenter 7 Network API (7.9+): messages, themes, and finding ProPresenter on the network.
 *
 * In ProPresenter: Settings → Network → Enable Network. That shows the computer's IP and port;
 * the API is plain HTTP on that port:
 *   GET  /version                    → { name, platform, os_version, host_description, api_version }
 *   GET  /v1/messages                → [{ id, message, tokens, theme, visible_on_network }]
 *   POST /v1/messages                → create a message
 *   PUT  /v1/message/{id}            → update a message
 *   POST /v1/message/{id}/trigger    → show it; body: [{ name: "<token>", text: { text: "K7X4" } }]
 *   GET  /v1/message/{id}/clear      → hide it
 *   GET  /v1/themes                  → theme groups → themes → slides
 */
import http from "node:http";
import net from "node:net";
import os from "node:os";
import mdns from "multicast-dns";
import type { ProId, ProMessageOption, ProPresenterMachine, ProThemeOption } from "../../../shared/types.js";

export class ProPresenterError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

/** One HTTP request to ProPresenter. */
function request<T>(host: string, port: number, method: string, path: string, body?: unknown, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host, port, method, path,
      headers: { Accept: "application/json", ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode ?? 0;
        if (status >= 400) return reject(new ProPresenterError(
          status === 404 ? "ProPresenter didn't recognise that request. Is it ProPresenter 7.9 or newer?" : `ProPresenter answered ${status}${text ? `: ${text.slice(0, 200)}` : ""}`, status));
        if (!text.trim()) return resolve(undefined as T);
        try { resolve(JSON.parse(text) as T); } catch { resolve(text as T); }
      });
    });
    req.on("timeout", () => req.destroy(new ProPresenterError(`No answer from ${host}:${port}. Is ProPresenter open with Network turned on?`)));
    req.on("error", (e: NodeJS.ErrnoException) => reject(e instanceof ProPresenterError ? e : new ProPresenterError(
      e.code === "ECONNREFUSED" ? `${host}:${port} refused the connection. Check the port in ProPresenter → Settings → Network.`
        : e.code === "EHOSTUNREACH" || e.code === "ENETUNREACH" || e.code === "ETIMEDOUT" ? `Can't reach ${host} from this Mac.`
          : e.code === "ENOTFOUND" ? `Can't find a computer called ${host}.` : e.message)));
    if (data) req.write(data);
    req.end();
  });
}

interface VersionReply { name: string; platform: string; os_version: string; host_description: string; api_version: string }
interface ApiMessage { id: ProId; message: string; tokens?: { name: string; text?: { text: string } }[]; theme: ProId; visible_on_network?: boolean }
interface ThemeGroup { id: ProId; themes?: { id: ProId; slides?: { id: ProId }[] }[]; groups?: ThemeGroup[] }

export class ProPresenter {
  constructor(public host: string, public port: number) {}
  /** Any API call (used by the ProPresenter control page). */
  api<T>(method: string, path: string, body?: unknown, timeoutMs?: number) { return this.call<T>(method, path, body, timeoutMs); }

  /** An image from the API (slide thumbnails). */
  image(path: string, timeoutMs = 5000): Promise<{ type: string; data: Buffer }> {
    if (!this.host || !this.port) return Promise.reject(new ProPresenterError("ProPresenter isn't set up."));
    return new Promise((resolve, reject) => {
      const req = http.request({ host: this.host, port: this.port, method: "GET", path, timeout: timeoutMs }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => (res.statusCode ?? 0) >= 400 ? reject(new ProPresenterError(`ProPresenter answered ${res.statusCode}`, res.statusCode)) : resolve({ type: String(res.headers["content-type"] ?? "image/jpeg"), data: Buffer.concat(chunks) }));
      });
      req.on("timeout", () => req.destroy(new ProPresenterError("ProPresenter didn't answer.")));
      req.on("error", (e) => reject(e instanceof ProPresenterError ? e : new ProPresenterError(e.message)));
      req.end();
    });
  }

  private call<T>(method: string, path: string, body?: unknown, timeoutMs?: number) {
    if (!this.host || !this.port) throw new ProPresenterError("Add the ProPresenter computer in Settings first.");
    return request<T>(this.host, this.port, method, path, body, timeoutMs);
  }

  async version(timeoutMs = 3000): Promise<ProPresenterMachine> {
    const v = await this.call<VersionReply>("GET", "/version", undefined, timeoutMs);
    if (!v || typeof v !== "object" || !("host_description" in v)) throw new ProPresenterError(`${this.host}:${this.port} answered, but it isn't ProPresenter's API.`);
    return { host: this.host, port: this.port, name: v.name ?? "", version: v.host_description ?? "", platform: v.platform ?? "" };
  }

  /** Every theme slide, flattened: "Theme › Slide" (just "Theme" when it has one slide). */
  async themes(): Promise<ProThemeOption[]> {
    const groups = (await this.call<ThemeGroup[] | ThemeGroup>("GET", "/v1/themes")) ?? [];
    const out: ProThemeOption[] = [];
    const walk = (g: ThemeGroup) => {
      for (const t of g.themes ?? []) {
        const slides = t.slides ?? [];
        for (const s of slides) {
          out.push({ id: s.id, theme: t.id.name, slide: s.id.name, label: slides.length > 1 ? `${t.id.name} › ${s.id.name}` : t.id.name });
        }
      }
      for (const c of g.groups ?? []) walk(c);
    };
    for (const g of Array.isArray(groups) ? groups : [groups]) walk(g);
    return out;
  }

  async messages(): Promise<ProMessageOption[]> {
    const list = (await this.call<ApiMessage[]>("GET", "/v1/messages")) ?? [];
    return list.map((m) => ({ id: m.id, message: m.message, tokens: (m.tokens ?? []).filter((t) => "text" in t).map((t) => t.name) }));
  }

  async rawMessages(): Promise<ApiMessage[]> {
    return (await this.call<ApiMessage[]>("GET", "/v1/messages")) ?? [];
  }

  /**
   * Make sure our own message exists with this text and theme; returns its uuid.
   * `{code}` in the text is a text token called "code".
   */
  async ensureMessage(name: string, text: string, theme: ProId | null): Promise<string> {
    const body = {
      id: { name, uuid: "", index: 0 },
      message: text,
      tokens: [{ name: "code", text: { text: "" } }],
      theme: theme ?? { name: "", uuid: "", index: 0 },
      visible_on_network: false,
      is_active: false,
    };
    const existing = (await this.rawMessages()).find((m) => m.id.name === name);
    if (!existing) {
      const made = await this.call<ApiMessage>("POST", "/v1/messages", body);
      if (made?.id?.uuid) return made.id.uuid;
      const again = (await this.rawMessages()).find((m) => m.id.name === name);
      if (!again) throw new ProPresenterError("ProPresenter didn't create the message.");
      return again.id.uuid;
    }
    const same = existing.message === text && (existing.theme?.uuid ?? "") === (theme?.uuid ?? "") && (existing.tokens ?? []).some((t) => t.name === "code");
    if (!same) await this.call("PUT", `/v1/message/${encodeURIComponent(existing.id.uuid)}`, { ...body, id: existing.id });
    return existing.id.uuid;
  }

  async trigger(messageId: string, token: string, value: string) {
    await this.call("POST", `/v1/message/${encodeURIComponent(messageId)}/trigger`, [{ name: token, text: { text: value } }]);
  }

  async clear(messageId: string) {
    await this.call("GET", `/v1/message/${encodeURIComponent(messageId)}/clear`);
  }
}

/* ───────────── Finding ProPresenter on the network ───────────── */

/** Ports people commonly give ProPresenter's network setting; the configured port is tried first. */
const COMMON_PORTS = [1025, 50001, 20652, 49232, 50000, 60157, 8080];

export function localSubnets(): { base: string; own: string }[] {
  const out: { base: string; own: string }[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      out.push({ base: a.address.split(".").slice(0, 3).join("."), own: a.address });
    }
  }
  return out.filter((s, i) => out.findIndex((x) => x.base === s.base) === i);
}

export function portOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

/** Ask Bonjour for anything that looks like ProPresenter (it advertises itself for its remotes). */
function bonjour(ms: number): Promise<{ host: string; port: number }[]> {
  return new Promise((resolve) => {
    let m: ReturnType<typeof mdns> | null = null;
    const found = new Map<string, { host: string; port: number }>();
    const srv = new Map<string, { target: string; port: number }>();
    const addr = new Map<string, string>();
    const finish = () => {
      try { m?.destroy(); } catch { /* ignore */ }
      for (const s of srv.values()) {
        const host = addr.get(s.target) ?? s.target.replace(/\.$/, "");
        found.set(`${host}:${s.port}`, { host, port: s.port });
      }
      resolve([...found.values()]);
    };
    try {
      m = mdns();
      const types = new Set(["_pro7proremote._tcp.local", "_pro7stagedsply._tcp.local", "_propresenter._tcp.local", "_pro7._tcp.local"]);
      m.on("response", (res) => {
        for (const r of [...res.answers, ...res.additionals]) {
          if (r.type === "PTR" && r.name === "_services._dns-sd._udp.local" && /pro/i.test(String(r.data))) {
            const t = String(r.data);
            if (!types.has(t)) { types.add(t); m?.query({ questions: [{ name: t, type: "PTR" }] }); }
          } else if (r.type === "PTR" && types.has(r.name)) {
            m?.query({ questions: [{ name: String(r.data), type: "SRV" }] });
          } else if (r.type === "SRV" && /pro/i.test(r.name)) {
            const d = r.data as { target: string; port: number };
            srv.set(r.name, { target: d.target, port: d.port });
            m?.query({ questions: [{ name: d.target, type: "A" }] });
          } else if (r.type === "A") {
            addr.set(r.name, String(r.data));
          }
        }
      });
      m.on("error", () => {});
      m.query({ questions: [{ name: "_services._dns-sd._udp.local", type: "PTR" }, ...[...types].map((name) => ({ name, type: "PTR" as const }))] });
    } catch { /* no multicast on this network */ }
    setTimeout(finish, ms);
  });
}

/**
 * Find ProPresenter computers: Bonjour first, then a quick look around this Mac's own network
 * (…1–254) on the configured and common ports. Everything found is confirmed with GET /version.
 */
export const _bonjour = bonjour;

export async function discover(preferredPort?: number): Promise<ProPresenterMachine[]> {
  const candidates = new Map<string, { host: string; port: number }>();
  const add = (host: string, port: number) => candidates.set(`${host}:${port}`, { host, port });

  const ports = [...new Set([preferredPort, ...COMMON_PORTS].filter((p): p is number => Boolean(p)))];
  const scan = async () => {
    const targets: { host: string; port: number }[] = [];
    for (const { base } of localSubnets().slice(0, 3)) {
      for (let i = 1; i < 255; i++) for (const port of ports) targets.push({ host: `${base}.${i}`, port });
    }
    let next = 0;
    await Promise.all(Array.from({ length: 128 }, async () => {
      while (next < targets.length) {
        const t = targets[next++];
        if (await portOpen(t.host, t.port, 350)) add(t.host, t.port);
      }
    }));
  };
  const [viaBonjour] = await Promise.all([bonjour(2500), scan()]);
  for (const b of viaBonjour) add(b.host, b.port);
  for (const port of ports) add("127.0.0.1", port); // ProPresenter on this same Mac

  const confirmed = await Promise.all([...candidates.values()].filter((c) => c.port).map((c) =>
    new ProPresenter(c.host, c.port).version(1500).catch(() => null)));
  // The same ProPresenter can answer on several addresses (e.g. this Mac's own): keep one, preferring
  // the network address so it also works from other computers.
  const best = new Map<string, ProPresenterMachine>();
  for (const m of confirmed) {
    if (!m) continue;
    const key = `${m.name}|${m.port}`;
    const had = best.get(key);
    if (!had || (had.host === "127.0.0.1" && m.host !== "127.0.0.1")) best.set(key, m);
  }
  return [...best.values()];
}
