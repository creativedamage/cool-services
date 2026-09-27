/**
 * /api/console: Allen & Heath dLive / Avantis channel names from a service's mic assignments.
 *
 * Each mic in Mic setup can be sent to one input, or two (a double patch, e.g. a second input for
 * in-ears). "Send names" writes the assigned person's first name (last initial added when two
 * people share a first name) to those inputs, and puts the mic's own label ("Vox 3") back on mics
 * nobody is on.
 */
import { Router } from "express";
import { z } from "zod";
import type { ConsoleSettingsView, ConsolePreview } from "../../../shared/types.js";
import { extras, mics } from "../lib/db.js";
import { consoleName, MAX_INPUTS, readName, writeNames, type ConsoleConfig } from "../lib/ahConsole.js";

export const consoleDefaults: ConsoleConfig = { enabled: false, model: "dlive", host: "", port: 51325, midiChannel: 1 };
export const consoleConfig = (): ConsoleConfig => ({ ...consoleDefaults, ...extras.get<Partial<ConsoleConfig>>("console", {}) });

export const consoleRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

consoleRouter.get("/config", (_req, res) => res.json(consoleConfig() satisfies ConsoleSettingsView));
consoleRouter.put("/config", (req, res) => {
  const p = z.object({
    enabled: z.boolean(), model: z.enum(["dlive", "avantis"]),
    host: z.string().trim().max(255).regex(/^[A-Za-z0-9.-]*$/, "Enter an IP address like 192.168.1.70"),
    port: z.number().int().min(1).max(65535), midiChannel: z.number().int().min(1).max(16),
  }).partial().parse(req.body);
  const next = { ...consoleConfig(), ...p };
  extras.set("console", next);
  res.json(next);
});

/** Connect and read input 1's name. */
consoleRouter.post("/test", h(async (_req, res) => {
  const cfg = consoleConfig();
  if (!cfg.host) return res.json({ ok: false, error: "Enter the console’s IP address first." });
  try {
    const name = await readName(cfg, 1);
    res.json({ ok: true, input1: name, note: name == null ? "Connected, but the console didn’t answer a name request. Check the MIDI channel matches Utility → Control → MIDI." : undefined });
  } catch (e) {
    res.json({ ok: false, error: (e as Error).message });
  }
}));

/** First names; add the last initial when two people on this service share a first name. */
function shortNames(people: { personId: string; name: string }[]): Map<string, string> {
  const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;
  const count = new Map<string, number>();
  const uniq = [...new Map(people.map((p) => [p.personId, p])).values()];
  for (const p of uniq) count.set(first(p.name).toLowerCase(), (count.get(first(p.name).toLowerCase()) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const p of uniq) {
    const parts = p.name.trim().split(/\s+/);
    const f = parts[0] ?? p.name;
    const dup = (count.get(f.toLowerCase()) ?? 0) > 1 && parts.length > 1;
    let n = dup ? `${f} ${parts[parts.length - 1][0]}` : f;
    if (dup && consoleName(n).length < n.length) n = `${f.slice(0, 6)} ${parts[parts.length - 1][0]}`; // keep the initial within 8
    out.set(p.personId, consoleName(n));
  }
  return out;
}

function preview(planId: string): ConsolePreview {
  const setup = mics.setup();
  const { assignments } = mics.plan(planId);
  const names = shortNames(assignments);
  const rows = setup.channels
    .filter((c) => c.consoleInputs?.length)
    .map((c) => {
      const a = assignments.find((x) => x.channelId === c.id);
      return { micId: c.id, micLabel: c.label, inputs: c.consoleInputs!, person: a?.name ?? null, name: a ? names.get(a.personId)! : consoleName(c.label) };
    });
  return { rows };
}

consoleRouter.get("/plans/:plan", (req, res) => res.json(preview(req.params.plan)));

consoleRouter.post("/plans/:plan/send", h(async (req, res) => {
  const cfg = consoleConfig();
  if (!cfg.enabled || !cfg.host) return res.status(400).json({ error: "console_off", message: "Turn on the Allen & Heath console in Preferences → Audio first." });
  const p = preview(req.params.plan);
  const writes = p.rows.flatMap((r) => r.inputs.map((input) => ({ input, name: r.name })));
  if (!writes.length) return res.status(400).json({ error: "nothing", message: "No mics are set to send to the console. In Mic setup, tick “Console” on a mic and enter its input." });
  const max = MAX_INPUTS[cfg.model];
  if (writes.some((w) => w.input > max)) return res.status(400).json({ error: "range", message: `${cfg.model === "dlive" ? "dLive" : "Avantis"} inputs go up to ${max}.` });
  try {
    const r = await writeNames(cfg, writes);
    res.json({ ...p, sent: r.sent });
  } catch (e) {
    res.status(502).json({ error: "console", message: (e as Error).message });
  }
}));
