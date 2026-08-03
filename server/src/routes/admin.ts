import { Router } from "express";
import bcrypt from "bcryptjs";
import fs from "fs/promises";
import multer from "multer";
import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "../db";
import { encrypt } from "../crypto";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { jobrightQueue } from "../queue";
import { deleteUserAccount } from "../accountDeletion";
import { storageStatePath } from "../paths";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      email: true,
      role: true,
      gmailAddress: true,
      plan: true,
      planExpiresAt: true,
      locked: true,
      createdAt: true,
      _count: { select: { resumes: true } },
    },
  });
  res.json({ users });
});

const updateUserSchema = z.object({
  plan: z.enum(["free", "pro", "elite"]).optional(),
  planExpiresAt: z.string().datetime().nullable().optional(),
  locked: z.boolean().optional(),
});

// Manually marking a member's plan as paid (checkout happens outside the
// app, so this is how an admin activates it after payment) - Pro/Elite also
// grants cross-team job visibility + the calendar view, purely by plan.
// planExpiresAt is caller-supplied rather than always "+30 days" so an admin
// can set any custom date, not just fixed increments.
adminRouter.patch("/users/:id", async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const targetId = Number(req.params.id);
  if (parsed.data.locked === true && targetId === req.user!.id) {
    return res.status(400).json({ error: "You can't lock your own account" });
  }

  const data: { plan?: string; planExpiresAt?: Date | null; locked?: boolean } = {};
  if (parsed.data.plan !== undefined) data.plan = parsed.data.plan;
  if (parsed.data.planExpiresAt !== undefined) {
    data.planExpiresAt = parsed.data.planExpiresAt ? new Date(parsed.data.planExpiresAt) : null;
  }
  if (parsed.data.locked !== undefined) data.locked = parsed.data.locked;

  const user = await prisma.user.update({ where: { id: targetId }, data });
  res.json({ id: user.id, plan: user.plan, planExpiresAt: user.planExpiresAt, locked: user.locked });
});

// Permanent - wipes every job/contact/resume the target owns along with the
// account (see accountDeletion.ts for why each table needs explicit
// cleanup). Same "not yourself" rule as locking, plus a last-admin guard so
// the team can't be left with no one able to reach this page.
adminRouter.delete("/users/:id", async (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user!.id) {
    return res.status(400).json({ error: "You can't delete your own account here - use Profile > Delete account" });
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) return res.status(404).json({ error: "User not found" });

  if (target.role === "admin") {
    const otherAdmins = await prisma.user.count({ where: { role: "admin", id: { not: targetId } } });
    if (otherAdmins === 0) return res.status(400).json({ error: "Can't delete the last admin account" });
  }

  await deleteUserAccount(targetId);
  res.json({ ok: true });
});

const promoCodeSchema = z.object({
  code: z.string().min(3).max(30),
  planTarget: z.enum(["pro", "elite"]),
  durationDays: z.number().int().min(1).max(365).default(30),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

adminRouter.get("/promo-codes", async (_req, res) => {
  const promoCodes = await prisma.promoCode.findMany({ orderBy: { id: "desc" } });
  res.json({ promoCodes });
});

adminRouter.post("/promo-codes", async (req, res) => {
  const parsed = promoCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const code = parsed.data.code.trim().toUpperCase();
  if (await prisma.promoCode.findUnique({ where: { code } })) {
    return res.status(409).json({ error: "A promo code with that name already exists" });
  }
  const promoCode = await prisma.promoCode.create({
    data: {
      code,
      planTarget: parsed.data.planTarget,
      durationDays: parsed.data.durationDays,
      maxRedemptions: parsed.data.maxRedemptions ?? null,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      createdById: req.user!.id,
    },
  });
  res.status(201).json({ promoCode });
});

adminRouter.delete("/promo-codes/:id", async (req, res) => {
  await prisma.promoRedemption.deleteMany({ where: { promoCodeId: Number(req.params.id) } });
  await prisma.promoCode.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

// Clears just the saved Playwright session (cookies/localStorage), leaving
// the email/password as-is - the "sign out and log back in" lever for when
// a job/search run is failing at the JobRight login step and a stale or
// half-broken session cookie is the suspect. The next task to need a
// browser context does a full loginFresh() instead of reusing it. Separate
// from PUT above (which also does this, but only as a side effect of
// re-entering credentials you don't actually want to change).
adminRouter.post("/jobright-config/reset-session", async (_req, res) => {
  await prisma.jobRightConfig.updateMany({ where: { id: 1 }, data: { storageStateJson: null } });
  await fs.rm(storageStatePath, { force: true });
  res.json({ ok: true });
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "member"]).default("member"),
});

adminRouter.post("/users", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const email = parsed.data.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    return res.status(409).json({ error: "A user with that email already exists" });
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, role: parsed.data.role },
  });
  res.status(201).json({ id: user.id, email: user.email, role: user.role });
});

const jobrightConfigSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

adminRouter.get("/jobright-config", async (_req, res) => {
  const config = await prisma.jobRightConfig.findUnique({ where: { id: 1 } });
  res.json({ email: config?.email ?? null, configured: !!config });
});

adminRouter.put("/jobright-config", async (req, res) => {
  const parsed = jobrightConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  await prisma.jobRightConfig.upsert({
    where: { id: 1 },
    create: { id: 1, email: parsed.data.email, passwordEnc: encrypt(parsed.data.password) },
    // Changing the login invalidates any saved session cookies.
    update: { email: parsed.data.email, passwordEnc: encrypt(parsed.data.password), storageStateJson: null },
  });
  res.json({ ok: true });
});

adminRouter.get("/settings", async (_req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  res.json({ dryRun: settings?.dryRun ?? true });
});

adminRouter.put("/settings", async (req, res) => {
  const dryRun = z.object({ dryRun: z.boolean() }).safeParse(req.body);
  if (!dryRun.success) return res.status(400).json({ error: "Invalid input" });
  await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1, dryRun: dryRun.data.dryRun },
    update: { dryRun: dryRun.data.dryRun },
  });
  res.json({ ok: true });
});

// Full cross-user activity log — replaces sent_log.csv.
adminRouter.get("/activity", async (_req, res) => {
  const contacts = await prisma.contact.findMany({
    orderBy: { id: "desc" },
    take: 500,
    include: { job: true, sentBy: { select: { email: true } } },
  });
  res.json({ contacts });
});

// Bulk-add jobs from a spreadsheet of posting URLs (one per row, optional
// "url"/"job url" header). Deliberately not xlsx/SheetJS - the npm-published
// build has unpatched high-severity prototype-pollution/ReDoS advisories;
// exceljs (.xlsx) plus a plain split for .csv covers the same need safely.
const bulkUpload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/\.(xlsx|csv)$/i.test(file.originalname)) return cb(new Error("Upload an .xlsx or .csv file"));
    cb(null, true);
  },
});

const URL_HEADER_NAMES = new Set(["url", "job url"]);
const BULK_UPLOAD_MAX_ROWS = 500;

async function extractSpreadsheetRows(file: Express.Multer.File): Promise<string[][]> {
  if (/\.csv$/i.test(file.originalname)) {
    return file.buffer
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.split(","));
  }
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled type defs predate @types/node's generic Buffer<T>, so
  // its `Buffer` parameter type structurally mismatches multer's - both are
  // actual Node Buffers at runtime.
  await workbook.xlsx.load(file.buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1); // exceljs row.values is 1-indexed with a leading empty slot
    rows.push(values.map((v) => (v == null ? "" : String(v))));
  });
  return rows;
}

adminRouter.post("/jobs/bulk-upload", bulkUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  let rows: string[][];
  try {
    rows = await extractSpreadsheetRows(req.file);
  } catch {
    return res.status(400).json({ error: "Couldn't read that file - is it a valid .xlsx or .csv?" });
  }

  let urlColIdx = 0;
  let dataRows = rows;
  if (rows.length) {
    const headerIdx = rows[0].findIndex((cell) => URL_HEADER_NAMES.has(cell.trim().toLowerCase()));
    if (headerIdx !== -1) {
      urlColIdx = headerIdx;
      dataRows = rows.slice(1);
    }
  }
  const rowNumOffset = dataRows === rows ? 1 : 2;

  const skipped: { row: number; reason: string }[] = [];
  const urls: string[] = [];
  dataRows.forEach((row, i) => {
    const raw = (row[urlColIdx] ?? "").trim();
    if (!raw) return; // blank trailing rows are expected, not worth reporting
    const rowNum = i + rowNumOffset;
    const parsed = z.string().url().safeParse(raw);
    if (!parsed.success) return skipped.push({ row: rowNum, reason: "Not a valid URL" });
    if (urls.length >= BULK_UPLOAD_MAX_ROWS) return skipped.push({ row: rowNum, reason: `Exceeded ${BULK_UPLOAD_MAX_ROWS}-row limit` });
    urls.push(parsed.data);
  });

  // Fan out onto the existing jobrightQueue ("add_job") rather than building
  // a separate pipeline - it already runs at concurrency 1 (the single
  // shared JobRight browser session), so these process one after another
  // automatically without a new sequencing mechanism.
  let queued = 0;
  for (const url of urls) {
    const job = await prisma.job.create({ data: { url, addedById: req.user!.id, status: "pending" } });
    await jobrightQueue.enqueue("add_job", { jobId: job.id, url }, req.user!.id);
    queued++;
  }
  res.json({ queued, skipped });
});
