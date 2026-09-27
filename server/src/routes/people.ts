import { Router } from "express";
import { z } from "zod";
import { audit, notes, users } from "../lib/db.js";
import type { Note, PersonProfile } from "../../../shared/types.js";

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
