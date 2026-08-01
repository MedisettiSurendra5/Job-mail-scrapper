import { Router } from "express";
import fs from "fs";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../db";
import { encrypt } from "../crypto";
import { requireAuth } from "../middleware/auth";
import { isGoogleOAuthConfigured } from "../automation/googleOAuth";
import { resumePathFor } from "../paths";
import { getEffectivePlan } from "../billing";
import { PLANS } from "../types";

export const usersRouter = Router();
usersRouter.use(requireAuth);

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") return cb(new Error("Resume must be a PDF"));
    cb(null, true);
  },
});

usersRouter.get("/me", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { resumes: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
  });
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    gmailAddress: user.gmailAddress,
    hasGmailAppPassword: !!user.gmailAppPasswordEnc,
    gmailOauthEmail: user.gmailOauthEmail,
    hasGoogleOAuth: !!user.googleRefreshTokenEnc,
    // Lets the Profile page say "unavailable on this server" up front instead
    // of offering a Connect button that navigates the tab to a raw 501.
    oauthConfigured: isGoogleOAuthConfigured(),
    resumes: user.resumes,
    signature: user.signature,
    sendEnabled: user.sendEnabled,
  });
});

const profileSchema = z.object({
  gmailAddress: z.string().email().optional(),
  gmailAppPassword: z.string().min(1).optional(),
  signature: z.string().optional(),
  sendEnabled: z.boolean().optional(),
});

usersRouter.put("/me", async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const data: { gmailAddress?: string; gmailAppPasswordEnc?: string; signature?: string; sendEnabled?: boolean } = {};
  if (parsed.data.gmailAddress) data.gmailAddress = parsed.data.gmailAddress;
  if (parsed.data.gmailAppPassword) data.gmailAppPasswordEnc = encrypt(parsed.data.gmailAppPassword);
  if (parsed.data.signature !== undefined) data.signature = parsed.data.signature;
  if (parsed.data.sendEnabled !== undefined) data.sendEnabled = parsed.data.sendEnabled;

  const user = await prisma.user.update({ where: { id: req.user!.id }, data });
  res.json({
    gmailAddress: user.gmailAddress,
    hasGmailAppPassword: !!user.gmailAppPasswordEnc,
    signature: user.signature,
    sendEnabled: user.sendEnabled,
  });
});

usersRouter.post("/me/resumes", upload.single("resume"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const existingCount = await prisma.resume.count({ where: { userId: user.id } });
  const maxResumes = PLANS[getEffectivePlan(user)].maxResumes;
  if (existingCount >= maxResumes) {
    return res.status(403).json({
      error:
        maxResumes === 1
          ? "Free plan is limited to 1 resume - upgrade to Pro for up to 5, or delete your current one first"
          : `You've reached the ${maxResumes}-resume limit - delete one first`,
    });
  }

  const resume = await prisma.resume.create({
    data: { userId: user.id, filename: req.file.originalname, isPrimary: existingCount === 0 },
  });
  fs.writeFileSync(resumePathFor(resume.id), req.file.buffer);
  res.status(201).json({ resume });
});

usersRouter.delete("/me/resumes/:id", async (req, res) => {
  const resume = await prisma.resume.findUnique({ where: { id: Number(req.params.id) } });
  if (!resume || resume.userId !== req.user!.id) return res.status(404).json({ error: "Resume not found" });

  await prisma.resume.delete({ where: { id: resume.id } });
  fs.rmSync(resumePathFor(resume.id), { force: true });

  // A primary must keep pointing at something whenever any resume remains -
  // the send pipeline depends on there always being at most one, unambiguous
  // primary resume per user.
  if (resume.isPrimary) {
    const next = await prisma.resume.findFirst({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" } });
    if (next) await prisma.resume.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
  res.json({ ok: true });
});

usersRouter.put("/me/resumes/:id/primary", async (req, res) => {
  const resume = await prisma.resume.findUnique({ where: { id: Number(req.params.id) } });
  if (!resume || resume.userId !== req.user!.id) return res.status(404).json({ error: "Resume not found" });

  await prisma.$transaction([
    prisma.resume.updateMany({ where: { userId: req.user!.id, isPrimary: true }, data: { isPrimary: false } }),
    prisma.resume.update({ where: { id: resume.id }, data: { isPrimary: true } }),
  ]);
  res.json({ ok: true });
});

usersRouter.get("/me/resumes/:id/file", async (req, res) => {
  const resume = await prisma.resume.findUnique({ where: { id: Number(req.params.id) } });
  if (!resume || resume.userId !== req.user!.id) return res.status(404).json({ error: "Resume not found" });

  const path = resumePathFor(resume.id);
  if (!fs.existsSync(path)) return res.status(404).json({ error: "File missing on disk" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${resume.filename.replace(/"/g, "")}"`);
  fs.createReadStream(path).pipe(res);
});

// Lets a user fall back to app-password sending if they want to stop using
// their connected Google account (or it's been revoked on Google's side).
usersRouter.delete("/me/gmail-oauth", async (req, res) => {
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { gmailOauthEmail: null, googleRefreshTokenEnc: null },
  });
  res.json({ ok: true });
});
