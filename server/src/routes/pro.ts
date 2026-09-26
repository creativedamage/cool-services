/**
 * /api/pro: watch and control ProPresenter computers (the side screens one, and the Kids & Nursery
 * one used for paging): slides, timers, stage screens, clearing layers. ProPresenter 7.9+ API.
 */
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { ProAction, ProControlState, ProMachine, ProSlide, ProTimer } from "../../../shared/types.js";
import { extras } from "../lib/db.js";
import { stored as pagingStored } from "../lib/paging.js";
import { ProPresenter, ProPresenterError } from "../lib/propresenter.js";

export const proRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch((e: unknown) => {
  if (e instanceof ProPresenterError) return res.status(502).json({ error: "propresenter", message: e.message });
  next(e);
});

/** Your ProPresenter computers: the ones added here, plus the Kids & Nursery one from paging. */
export function machines(): ProMachine[] {
  const own = extras.get<ProMachine[]>("proMachines", []);
  const p = pagingStored().config.propresenter;
  const paging: ProMachine[] = p.host && p.port && !own.some((m) => m.host === p.host && m.port === p.port)
    ? [{ id: "paging", name: "Kids & Nursery (paging)", host: p.host, port: p.port, builtIn: true }] : [];
  return [...own, ...paging];
}
const machine = (id: string) => {
  const m = machines().find((x) => x.id === id);
  if (!m) throw new ProPresenterError("That ProPresenter computer isn't set up.", 404);
  return new ProPresenter(m.host, m.port);
};

proRouter.get("/machines", h(async (_req, res) => res.json(machines())));
proRouter.put("/machines", h(async (req, res) => {
  const list = z.array(z.object({
    id: z.string().max(40).optional(), name: z.string().trim().min(1).max(60),
    host: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9.\-:]+$/), port: z.number().int().min(1).max(65535),
  })).max(10).parse(req.body);
  extras.set("proMachines", list.map((m) => ({ ...m, id: m.id && m.id !== "paging" ? m.id : crypto.randomUUID() })));
  res.json(machines());
}));

const colorOf = (c: { red?: number; green?: number; blue?: number } | null | undefined) =>
  c && typeof c.red === "number" ? `rgb(${Math.round(c.red * 255)} ${Math.round((c.green ?? 0) * 255)} ${Math.round((c.blue ?? 0) * 255)})` : null;
const seconds = (t: string) => { const neg = t.startsWith("-"); const p = t.replace("-", "").split(":").map(Number); const v = p.reduce((a, b) => a * 60 + (b || 0), 0); return neg ? -v : v; };

/** Everything the control page shows, in one go (each part is optional: older versions lack some). */
proRouter.get("/:id/state", h(async (req, res) => {
  const pro = machine(req.params.id);
  const safe = <T,>(p: Promise<T>, d: T) => p.catch(() => d);
  let version;
  try { version = await pro.version(2500); } catch (e) {
    return res.json({ ok: false, error: (e as Error).message, presentation: null, slideIndex: null, current: null, next: null, timers: [], stageMessage: "", stageScreens: [], stageLayouts: [], clearGroups: [], looks: [], at: new Date().toISOString() } satisfies ProControlState);
  }
  type Pres = { presentation?: { id?: { uuid: string; name: string }; groups?: { name: string; color?: { red: number; green: number; blue: number }; slides?: { enabled?: boolean; notes?: string; text?: string; label?: string }[] }[] } };
  const [pres, idx, slide, cur, cfg, msg, screens, layouts, map, groups, looks] = await Promise.all([
    safe(pro.api<Pres>("GET", "/v1/presentation/active"), {} as Pres),
    safe(pro.api<{ presentation_index?: { index: number; presentation_id?: { uuid: string } } | null }>("GET", "/v1/presentation/slide_index"), {}),
    safe(pro.api<{ current?: { text: string; notes: string }; next?: { text: string; notes: string } }>("GET", "/v1/status/slide"), {}),
    safe(pro.api<{ id: { uuid: string; name: string; index: number }; time: string; state: string }[]>("GET", "/v1/timers/current"), []),
    safe(pro.api<{ id: { uuid: string; name: string; index: number }; allows_overrun?: boolean; countdown?: { duration: number }; count_down_to_time?: unknown; elapsed?: unknown }[]>("GET", "/v1/timers"), []),
    safe(pro.api<string>("GET", "/v1/stage/message"), ""),
    safe(pro.api<{ uuid: string; name: string; index: number }[]>("GET", "/v1/stage/screens"), []),
    safe(pro.api<{ id: { uuid: string; name: string; index: number } }[]>("GET", "/v1/stage/layouts"), []),
    safe(pro.api<{ screen: { uuid: string; name: string; index: number }; layout: { uuid: string; name: string; index: number } }[]>("GET", "/v1/stage/layout_map"), []),
    safe(pro.api<{ id: { uuid: string; name: string; index: number } }[]>("GET", "/v1/clear/groups"), []),
    safe(pro.api<{ id: { uuid: string; name: string; index: number } }[]>("GET", "/v1/looks"), []),
  ]);
  const p = pres.presentation;
  let n = 0;
  const slides: ProSlide[] = (p?.groups ?? []).flatMap((g) => (g.slides ?? []).map((s) => ({
    index: n++, group: g.name ?? "", groupColor: colorOf(g.color), label: s.label ?? "", text: s.text ?? "", enabled: s.enabled !== false,
  })));
  const timers: ProTimer[] = (cur ?? []).map((t) => {
    const c = (cfg ?? []).find((x) => x.id?.uuid === t.id.uuid);
    return {
      id: t.id, time: t.time, state: t.state,
      kind: c?.countdown ? "countdown" : c?.count_down_to_time ? "count_down_to_time" : c?.elapsed ? "elapsed" : "unknown",
      duration: c?.countdown?.duration ?? null, allowsOverrun: Boolean(c?.allows_overrun),
    };
  });
  const state: ProControlState = {
    ok: true, name: version.name, version: version.version,
    presentation: p?.id ? { uuid: p.id.uuid, name: p.id.name, slides } : null,
    slideIndex: idx?.presentation_index?.index ?? null,
    current: slide?.current ?? null, next: slide?.next ?? null,
    timers, stageMessage: typeof msg === "string" ? msg : "",
    stageScreens: (screens ?? []).map((s) => ({ id: s, layout: (map ?? []).find((m) => m.screen?.uuid === s.uuid)?.layout ?? null })),
    stageLayouts: (layouts ?? []).map((l) => l.id).filter(Boolean),
    clearGroups: (groups ?? []).map((g) => g.id).filter(Boolean),
    looks: (looks ?? []).map((g) => g.id).filter(Boolean),
    at: new Date().toISOString(),
  };
  res.json(state);
}));

const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("next") }), z.object({ type: z.literal("previous") }),
  z.object({ type: z.literal("trigger"), uuid: z.string().max(80), index: z.number().int().min(0) }),
  z.object({ type: z.literal("clear"), layer: z.enum(["slide", "media", "props", "messages", "announcements", "audio", "video_input", "all"]) }),
  z.object({ type: z.literal("clearGroup"), id: z.string().max(80) }),
  z.object({ type: z.literal("look"), id: z.string().max(80) }),
  z.object({ type: z.literal("timer"), id: z.string().max(80), op: z.enum(["start", "stop", "reset"]) }),
  z.object({ type: z.literal("timerSet"), id: z.string().max(80), duration: z.number().int().min(0).max(24 * 3600), allowsOverrun: z.boolean().optional() }),
  z.object({ type: z.literal("timerAdd"), id: z.string().max(80), seconds: z.number().int().min(-86400).max(86400) }),
  z.object({ type: z.literal("stageMessage"), text: z.string().max(500).nullable() }),
  z.object({ type: z.literal("stageLayout"), screen: z.string().max(80), layout: z.string().max(80) }),
]);

proRouter.post("/:id/action", h(async (req, res) => {
  const pro = machine(req.params.id);
  const a = Action.parse(req.body) as ProAction;
  const e = encodeURIComponent;
  switch (a.type) {
    case "next": await pro.api("GET", "/v1/trigger/next"); break;
    case "previous": await pro.api("GET", "/v1/trigger/previous"); break;
    case "trigger": await pro.api("GET", `/v1/presentation/${e(a.uuid)}/${a.index}/trigger`); break;
    case "clear":
      if (a.layer === "all") for (const l of ["slide", "media", "props", "messages", "announcements", "audio", "video_input"]) await pro.api("GET", `/v1/clear/layer/${l}`).catch(() => {});
      else await pro.api("GET", `/v1/clear/layer/${a.layer}`);
      break;
    case "clearGroup": await pro.api("GET", `/v1/clear/group/${e(a.id)}/trigger`); break;
    case "look": await pro.api("GET", `/v1/look/${e(a.id)}/trigger`); break;
    case "timer": await pro.api("GET", `/v1/timer/${e(a.id)}/${a.op}`); break;
    case "timerSet": {
      const cfg = await pro.api<{ id: { uuid: string; name: string; index: number }; allows_overrun?: boolean }>("GET", `/v1/timer/${e(a.id)}`);
      await pro.api("PUT", `/v1/timer/${e(a.id)}`, { id: cfg.id, allows_overrun: a.allowsOverrun ?? cfg.allows_overrun ?? false, countdown: { duration: a.duration } });
      break;
    }
    case "timerAdd": await pro.api("GET", `/v1/timer/${e(a.id)}/increment/${a.seconds}`); break;
    case "stageMessage":
      if (a.text) await pro.api("PUT", "/v1/stage/message", a.text); else await pro.api("DELETE", "/v1/stage/message");
      break;
    case "stageLayout": await pro.api("GET", `/v1/stage/screen/${e(a.screen)}/layout/${e(a.layout)}`); break;
  }
  res.json({ ok: true });
}));

/** Slide thumbnails (cached briefly; the same slides are asked for over and over). */
const thumbs = new Map<string, { at: number; type: string; data: Buffer }>();
proRouter.get("/:id/thumb", h(async (req, res) => {
  const uuid = String(req.query.uuid ?? ""), index = Number(req.query.index ?? 0), q = Math.min(800, Math.max(100, Number(req.query.q) || 320));
  if (!/^[\w-]+$/.test(uuid)) return res.status(400).end();
  const key = `${req.params.id}:${uuid}:${index}:${q}`;
  let hit = thumbs.get(key);
  if (!hit || Date.now() - hit.at > 60_000) {
    const img = await machine(req.params.id).image(`/v1/presentation/${encodeURIComponent(uuid)}/thumbnail/${index}?quality=${q}`);
    hit = { at: Date.now(), ...img };
    thumbs.set(key, hit);
    if (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value!);
  }
  res.set("Cache-Control", "private, max-age=30").type(hit.type).send(hit.data);
}));
