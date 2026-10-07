import type { MicAssignment, MicChannel, MicFilter, MicSetup, ShureModel, TeamMember } from "@shared/types";

export const MODEL_LABEL: Record<ShureModel, string> = { ULXD: "ULX-D", QLXD: "QLX-D", SLXD: "SLX-D", AD: "Axient Digital", UHFR: "UHF-R" };
const norm = (s: string) => s.trim().toLowerCase();

/** One entry per person, with every position they're serving in this plan (e.g. Worship Leader + Acoustic Guitar). */
export interface Serving {
  personId: string;
  name: string;
  avatarUrl: string | null;
  positions: string[];
  confirmed: boolean;
}

export function servingPeople(roster: TeamMember[]): Serving[] {
  const map = new Map<string, Serving>();
  for (const m of roster) {
    if (m.status === "D") continue;
    const p = map.get(m.personId) ?? { personId: m.personId, name: m.name, avatarUrl: m.avatarUrl, positions: [], confirmed: false };
    if (!p.positions.includes(m.positionName)) p.positions.push(m.positionName);
    p.confirmed ||= m.status === "C";
    map.set(m.personId, p);
  }
  return [...map.values()];
}

/** A service type's filter (empty when it has none). */
export const filterFor = (setup: MicSetup, serviceTypeId: string | null | undefined): MicFilter =>
  (serviceTypeId && setup.serviceTypes?.[serviceTypeId]) || {};

/** The setup as one service type sees it: each mic's positions from that service type's filter. */
export function setupFor(setup: MicSetup, serviceTypeId: string | null | undefined): MicSetup {
  const pos = filterFor(setup, serviceTypeId).positions;
  if (!pos) return setup;
  return { ...setup, channels: setup.channels.map((c) => (pos[c.id] ? { ...c, positions: pos[c.id] } : c)) };
}

/** Hide people who already have a mic of that kind? On unless the service type turned it off. */
export const hidesAssigned = (setup: MicSetup, serviceTypeId: string | null | undefined) =>
  filterFor(setup, serviceTypeId).hideAssigned !== false;

export const fitsChannel = (ch: MicChannel, p: Serving) => ch.positions.some((x) => p.positions.some((y) => norm(x) === norm(y)));

/**
 * Change one channel. A person can have one mic of each kind — e.g. a worship leader on Vox 1
 * AND the AG pack. Picking someone who already has a mic of the same kind moves them.
 */
export function assignChannel(setup: MicSetup, current: MicAssignment[], channelId: string, person: Serving | null): MicAssignment[] {
  const kindOf = new Map(setup.channels.map((c) => [c.id, c.kind]));
  const kind = kindOf.get(channelId);
  const rest = current.filter((a) => a.channelId !== channelId && !(person && a.personId === person.personId && kindOf.get(a.channelId) === kind));
  return person ? [...rest, { channelId, personId: person.personId, name: person.name }] : rest;
}

/**
 * Fill empty channels from the team, keeping any manual choices:
 *  1. People go back on the mic they used last time (per kind), if it's for one of their positions.
 *  2. Remaining channels take the next person whose position matches (confirmed before pending).
 * Someone can get one mic of each kind (vocal + pack). Declined people are never assigned.
 */
export function autoAssign(setup: MicSetup, roster: TeamMember[], current: MicAssignment[], usual: Record<string, string>): MicAssignment[] {
  const people = servingPeople(roster).sort((a, b) => Number(b.confirmed) - Number(a.confirmed));
  const serving = new Set(people.map((p) => p.personId));
  const kindOf = new Map(setup.channels.map((c) => [c.id, c.kind]));
  const out = current.filter((a) => serving.has(a.personId) && kindOf.has(a.channelId));
  const taken = new Set(out.map((a) => `${kindOf.get(a.channelId)}:${a.personId}`));
  const filled = new Set(out.map((a) => a.channelId));
  const open = () => setup.channels.filter((c) => !filled.has(c.id) && c.positions.length);
  const put = (c: MicChannel, p: Serving) => {
    out.push({ channelId: c.id, personId: p.personId, name: p.name });
    taken.add(`${c.kind}:${p.personId}`);
    filled.add(c.id);
  };

  for (const c of open()) {
    const p = people.find((x) => !taken.has(`${c.kind}:${x.personId}`) && usual[`${c.kind}:${x.personId}`] === c.id && fitsChannel(c, x));
    if (p) put(c, p);
  }
  for (const c of open()) {
    const p = people.find((x) => !taken.has(`${c.kind}:${x.personId}`) && fitsChannel(c, x));
    if (p) put(c, p);
  }
  return out;
}
