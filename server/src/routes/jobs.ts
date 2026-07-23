import { Request, Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { jobrightQueue } from "../queue";
import { assertWithinQuota, getEffectivePlan } from "../billing";
import { FILTER_OPTIONS } from "../types";

// Every member's jobs/contacts/activity are private to them - only an admin
// has cross-member visibility. Pro/Elite unlocks the date filter/calendar
// view (see canUseDateFilter below), but only over a member's own jobs, not
// the rest of the team's - that's an admin-only capability, not a paid perk.
async function canUseDateFilter(req: Request): Promise<boolean> {
  if (req.user!.role === "admin") return true;
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { plan: true, planExpiresAt: true },
  });
  return getEffectivePlan(me) !== "free";
}

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

const addJobSchema = z.object({ url: z.string().url() });

const searchSchema = z.object({
  searchTerm: z.string().min(1),
  applyFilters: z.boolean().default(true),
  country: z.array(z.string()).default([]),
  company: z.string().default(""),
  seniority: z.array(z.string()).default([...FILTER_OPTIONS.seniority.slice(1, 3)]),
  jobTypes: z.array(z.string()).default([FILTER_OPTIONS.jobTypes[0]]),
  workModel: z.array(z.string()).default([]),
  daysAgo: z.string().default("Past 24 hours"),
  maxPerRun: z.number().int().min(1).max(50).default(10),
});

jobsRouter.get("/filter-options", (_req, res) => res.json(FILTER_OPTIONS));

// A member's activity feed only ever shows contacts *they* sent to - never
// another member's or the admin's sends. Admins alone get the full
// cross-team picture (same data as GET /admin/activity).
jobsRouter.get("/activity", async (req, res) => {
  const isAdmin = req.user!.role === "admin";
  const contacts = await prisma.contact.findMany({
    where: {
      status: { in: ["sent", "dry_run", "send_failed", "skipped_disabled"] },
      ...(isAdmin ? {} : { sentById: req.user!.id }),
    },
    orderBy: { sentAt: "desc" },
    take: 100,
    include: { job: { select: { title: true, company: true } }, sentBy: { select: { email: true } } },
  });
  res.json({ contacts });
});

// Interactive, review-first search: any authenticated user can browse
// results, but this never auto-sends - results land as ordinary Job rows,
// same as a pasted-URL add, so the existing manual review/send flow applies.
jobsRouter.post("/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const { maxPerRun, ...filters } = parsed.data;
  const task = await jobrightQueue.enqueue(
    "run_search",
    { filters, maxPerRun, requestedBy: req.user!.id, autoSend: false },
    req.user!.id
  );
  res.json({ taskId: task.id });
});

jobsRouter.post("/", async (req, res) => {
  const parsed = addJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid job posting URL" });

  try {
    await assertWithinQuota(req.user!.id);
  } catch (e: any) {
    return res.status(e.status || 403).json({ error: e.message || "Daily limit reached" });
  }

  const job = await prisma.job.create({
    data: { url: parsed.data.url, addedById: req.user!.id, status: "pending", source: "url" },
  });
  const task = await jobrightQueue.enqueue("add_job", { jobId: job.id, url: job.url }, req.user!.id);
  res.status(201).json({ job, taskId: task.id });
});

// Only an admin sees the whole team's jobs - every plain member (regardless
// of plan) only ever sees jobs they personally added. Pro/Elite still
// unlocks the date filter/calendar view, just scoped to that same
// already-private job set, not a wider one.
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

jobsRouter.get("/", async (req, res) => {
  const isAdmin = req.user!.role === "admin";
  const where: Record<string, unknown> = isAdmin ? {} : { addedById: req.user!.id };

  const { from, to } = req.query;
  if (typeof from === "string" || typeof to === "string") {
    if (!(await canUseDateFilter(req))) return res.status(403).json({ error: "Date filtering is a Pro/Elite feature" });
    if ((typeof from === "string" && !dateOnly.test(from)) || (typeof to === "string" && !dateOnly.test(to))) {
      return res.status(400).json({ error: "Invalid date" });
    }
    where.datePosted = {
      ...(typeof from === "string" ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(typeof to === "string" ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
    };
  }

  const jobs = await prisma.job.findMany({
    where,
    orderBy: { id: "desc" },
    include: {
      addedBy: { select: { email: true, role: true } },
      _count: { select: { contacts: true } },
    },
  });
  res.json({ jobs });
});

// Shared by the job-detail/contacts/pull-emails endpoints below - a plain
// member can't reach another member's job by guessing its id any more than
// they could see it in their own job list. Only an admin has cross-member
// access; Pro/Elite no longer does (see the note above GET /).
async function canSeeJob(req: Request, addedById: number): Promise<boolean> {
  return req.user!.role === "admin" || req.user!.id === addedById;
}

jobsRouter.get("/:id", async (req, res) => {
  const job = await prisma.job.findUnique({
    where: { id: Number(req.params.id) },
    include: { addedBy: { select: { email: true, role: true } } },
  });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (!(await canSeeJob(req, job.addedById))) return res.status(404).json({ error: "Job not found" });
  res.json({ job });
});

const appliedSchema = z.object({ applied: z.boolean() });

// Lets a user mark a job as actually applied to (distinct from just adding
// it / pulling contacts) - the "Applied" session on the Dashboard filters on
// this flag.
jobsRouter.patch("/:id/applied", async (req, res) => {
  const parsed = appliedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const job = await prisma.job.findUnique({ where: { id: Number(req.params.id) } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (!(await canSeeJob(req, job.addedById))) return res.status(404).json({ error: "Job not found" });

  const updated = await prisma.job.update({
    where: { id: job.id },
    data: { applied: parsed.data.applied, appliedAt: parsed.data.applied ? new Date() : null },
  });
  res.json({ job: updated });
});

jobsRouter.post("/:id/pull-emails", async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: Number(req.params.id) } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (!(await canSeeJob(req, job.addedById))) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "ready") return res.status(409).json({ error: "Job is not ready yet" });

  const task = await jobrightQueue.enqueue("pull_emails", { jobId: job.id }, req.user!.id);
  res.json({ taskId: task.id });
});

// Removing a job is stricter than viewing it: a Pro/Elite member can *see*
// the whole team's jobs, but that doesn't grant deleting other people's
// jobs - only the job's own adder or an admin can remove it.
jobsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (req.user!.role !== "admin" && job.addedById !== req.user!.id) {
    return res.status(403).json({ error: "You can only remove jobs you added" });
  }

  await prisma.contact.deleteMany({ where: { jobId: id } });
  await prisma.job.delete({ where: { id } });
  res.json({ ok: true });
});

jobsRouter.get("/:id/contacts", async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: Number(req.params.id) } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (!(await canSeeJob(req, job.addedById))) return res.status(404).json({ error: "Job not found" });

  const contacts = await prisma.contact.findMany({
    where: { jobId: Number(req.params.id) },
    orderBy: { id: "asc" },
    include: { sentBy: { select: { email: true } } },
  });
  res.json({ contacts });
});
