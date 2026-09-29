import { Router } from "express";
import { z } from "zod";
import { audit, extras, notes, users } from "../lib/db.js";
import type { Note, PersonProfile, WorkflowAccessRequest, WorkflowSummary } from "../../../shared/types.js";

export const peopleRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

peopleRouter.get("/workflows", h(async (req, res) => res.json(await req.pco.listWorkflows())));

peopleRouter.get("/workflows/:wf/board", h(async (req, res) => res.json(await req.pco.getBoard(req.params.wf))));

const Move = z.object({ toStepId: z.string().nullable(), skip: z.boolean().optional(), personId: z.string().optional() });
peopleRouter.post("/workflows/:wf/cards/:card/move", h(async (req, res) => {
  const body = Move.parse(req.body);
  const card = await req.pco.moveCard(req.params.wf, req.params.card, body.toStepId, body.skip, body.personId);
  await audit(req.user.id, "card.move", "WorkflowCard", req.params.card, body);
  res.json(card);
}));

peopleRouter.get("/contacts", h(async (req, res) => {
  const ids = String(req.query.ids ?? "").split(",").filter(Boolean);
  res.json(await req.pco.getContacts(ids));
}));

peopleRouter.get("/people/:person", h(async (req, res) => res.json(await req.pco.getPerson(req.params.person))));
peopleRouter.get("/people/:person/profile", h(async (req, res) => res.json(await req.pco.getProfile(req.params.person))));

/**
 * Email someone through Planning Center. Planning Center's API only sends email through a workflow
 * card (it goes from you and shows on the card's activity), so this uses one of their active cards.
 */
peopleRouter.post("/people/:person/email", h(async (req, res) => {
  const { subject, body, cardId } = Email.extend({ cardId: z.string().max(40).optional() }).parse(req.body);
  const profile: PersonProfile = await req.pco.getProfile(req.params.person);
  const card = profile.cards.find((c) => c.id === cardId) ?? profile.cards[0];
  if (!card) return res.status(400).json({ error: "no_card", message: "Planning Center can only send email to someone in a workflow. Use Open in Mail instead." });
  await req.pco.sendCardEmail(req.params.person, card.id, subject, body);
  await audit(req.user.id, "person.email", "Person", req.params.person, { subject, card: card.id });
  res.json({ ok: true, via: card.workflowName });
}));

/** Card notes + PCO profile notes + staff-only internal notes, newest first. */
peopleRouter.get("/people/:person/cards/:card/notes", h(async (req, res) => {
  const [pco, internal] = await Promise.all([
    req.pco.getNotes(req.params.person, req.params.card),
    Promise.resolve(notes.forPerson(req.params.person)),
  ]);
  const mine: Note[] = internal.map((n) => ({
    id: `internal-${n.id}`, body: n.body, authorName: users.get(n.authorId)?.name ?? "Staff", createdAt: n.createdAt, source: "internal", category: "Staff-only",
  }));
  res.json([...pco, ...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}));

const NewNote = z.object({ body: z.string().min(1).max(5000), internal: z.boolean().default(false) });
peopleRouter.post("/people/:person/cards/:card/notes", h(async (req, res) => {
  const { body, internal } = NewNote.parse(req.body);
  let note: Note;
  if (internal) {
    const n = notes.create({ pcoPersonId: req.params.person, pcoCardId: req.params.card, body, authorId: req.user.id });
    note = { id: `internal-${n.id}`, body, authorName: req.user.name, createdAt: n.createdAt, source: "internal", category: "Staff-only" };
  } else {
    note = await req.pco.addCardNote(req.params.person, req.params.card, body);
  }
  await audit(req.user.id, "card.note", "WorkflowCard", req.params.card, { internal });
  res.status(201).json(note);
}));

const Email = z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(20000) });
peopleRouter.post("/people/:person/cards/:card/email", h(async (req, res) => {
  const { subject, body } = Email.parse(req.body);
  await req.pco.sendCardEmail(req.params.person, req.params.card, subject, body);
  await audit(req.user.id, "card.email", "WorkflowCard", req.params.card, { subject });
  res.json({ ok: true });
}));

/* ───────────── Workflow access: sharing, and asking for a workflow ───────────── */

const Group = z.enum(["No Access", "Viewer", "Editor", "Manager"]);
const WfId = z.string().regex(/^\w{1,40}$/);

async function managed(req: any, wf: string) {
  const list: WorkflowSummary[] = await req.pco.listWorkflows();
  const w = list.find((x) => x.id === wf);
  if (!w?.canManage) throw Object.assign(new Error("Only this workflow’s managers can share it."), { status: 403 });
  return w;
}

peopleRouter.get("/workflows/:wf/shares", h(async (req, res) => {
  await managed(req, WfId.parse(req.params.wf));
  res.json(await req.pco.listShares(req.params.wf));
}));
peopleRouter.put("/workflows/:wf/shares", h(async (req, res) => {
  const w = await managed(req, WfId.parse(req.params.wf));
  const { personId, group } = z.object({ personId: z.string().regex(/^\d{1,20}$/), group: Group }).parse(req.body);
  const out = await req.pco.setShare(w.id, personId, group);
  await audit(req.user.id, "workflow.share", "Workflow", w.id, { personId, group });
  res.json(out);
}));
peopleRouter.delete("/workflows/:wf/shares/:share", h(async (req, res) => {
  const w = await managed(req, WfId.parse(req.params.wf));
  const out = await req.pco.removeShare(w.id, z.string().regex(/^\w{1,40}$/).parse(req.params.share));
  await audit(req.user.id, "workflow.unshare", "Workflow", w.id, { share: req.params.share });
  res.json(out);
}));
peopleRouter.get("/people-search", h(async (req, res) => res.json(await req.pco.searchPeople(String(req.query.q ?? "").slice(0, 60)))));

const REQ_KEY = "workflowRequests";
const allRequests = () => extras.get<WorkflowAccessRequest[]>(REQ_KEY, []);
const saveRequests = (list: WorkflowAccessRequest[]) => extras.set(REQ_KEY, list.slice(-300));

/** Your own requests, and the ones waiting on you (for workflows you manage). */
peopleRouter.get("/workflow-requests", h(async (req, res) => {
  const me = (await req.pco.me()).id;
  const list: WorkflowSummary[] = await req.pco.listWorkflows();
  const manage = new Set(list.filter((w) => w.canManage).map((w) => w.id));
  const all = allRequests();
  res.json({
    mine: all.filter((r) => r.personId === me),
    toReview: all.filter((r) => r.state === "pending" && manage.has(r.workflowId) && r.personId !== me),
  });
}));
peopleRouter.post("/workflow-requests", h(async (req, res) => {
  const { workflowId, note } = z.object({ workflowId: WfId, note: z.string().trim().max(300).optional() }).parse(req.body);
  const list: WorkflowSummary[] = await req.pco.listWorkflows();
  const w = list.find((x) => x.id === workflowId);
  if (!w) return res.status(404).json({ error: "not_found", message: "That workflow isn’t in Planning Center anymore." });
  const me = await req.pco.me();
  const all = allRequests().filter((r) => !(r.personId === me.id && r.workflowId === workflowId && r.state === "pending"));
  const r: WorkflowAccessRequest = {
    id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, workflowId, workflowName: w.name,
    personId: me.id, personName: me.name, avatarUrl: me.avatarUrl, note: note || null, requestedAt: new Date().toISOString(), state: "pending",
  };
  saveRequests([...all, r]);
  res.json(r);
}));
peopleRouter.post("/workflow-requests/:id/:decision", h(async (req, res) => {
  const decision = z.enum(["approve", "deny", "withdraw"]).parse(req.params.decision);
  const all = allRequests();
  const r = all.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: "not_found", message: "That request is gone." });
  if (decision === "withdraw") {
    if (r.personId !== (await req.pco.me()).id) return res.status(403).json({ error: "forbidden", message: "Only the person who asked can withdraw it." });
    saveRequests(all.filter((x) => x.id !== r.id));
    return res.json({ ok: true });
  }
  await managed(req, r.workflowId);
  const group = decision === "approve" ? Group.parse(req.body?.group ?? "Editor") : undefined;
  if (group) await req.pco.setShare(r.workflowId, r.personId, group);
  Object.assign(r, { state: decision === "approve" ? "approved" : "denied", decidedBy: req.user.name, decidedAt: new Date().toISOString(), group });
  saveRequests(all);
  await audit(req.user.id, `workflow.request.${decision}`, "Workflow", r.workflowId, { personId: r.personId, group });
  res.json(r);
}));
