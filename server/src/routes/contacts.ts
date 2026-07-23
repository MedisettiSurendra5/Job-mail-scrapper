import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { emailQueue } from "../queue";
import { assertWithinQuota } from "../billing";

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

const sendSchema = z.object({
  subject: z.string().optional(),
  body: z.string().optional(),
});

async function enqueueSend(
  contactId: number,
  userId: number,
  isAdmin: boolean,
  overrides: { subject?: string; body?: string }
) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { job: { include: { addedBy: { select: { role: true } } } } },
  });
  // Same visibility rule as jobs.ts's canSeeJob: your own job's contacts, or
  // any admin-posted job's contacts (shared team work items), or everything
  // if you're the admin. Treat anything else as if it didn't exist, same as
  // the job-visibility checks elsewhere, rather than leaking a 403.
  const canAct = !!contact && (isAdmin || contact.job.addedById === userId || contact.job.addedBy.role === "admin");
  if (!canAct) {
    throw { status: 404, message: "Contact not found" };
  }
  if (!contact.email) throw { status: 400, message: "This contact has no email on file" };
  if (contact.status === "sent") {
    throw { status: 409, message: "Already sent to this contact" };
  }
  await assertWithinQuota(userId);
  return emailQueue.enqueue(
    "send_email",
    { contactId, userId, subject: overrides.subject, body: overrides.body },
    userId
  );
}

contactsRouter.post("/:id/send", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  try {
    const task = await enqueueSend(Number(req.params.id), req.user!.id, req.user!.role === "admin", parsed.data);
    res.json({ taskId: task.id });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to queue send" });
  }
});

const bulkSchema = z.object({ contactIds: z.array(z.number().int()).min(1) });

contactsRouter.post("/send-bulk", async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const isAdmin = req.user!.role === "admin";
  const results: { contactId: number; taskId?: number; error?: string }[] = [];
  for (const contactId of parsed.data.contactIds) {
    try {
      const task = await enqueueSend(contactId, req.user!.id, isAdmin, {});
      results.push({ contactId, taskId: task.id });
    } catch (e: any) {
      results.push({ contactId, error: e.message || "Failed to queue send" });
    }
  }
  res.json({ results });
});
