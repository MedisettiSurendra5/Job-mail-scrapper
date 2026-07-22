import { Router } from "express";
import fs from "fs";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../db";
import { encrypt } from "../crypto";
import { requireAuth } from "../middleware/auth";
import { resumePathFor } from "../paths";

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
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    gmailAddress: user.gmailAddress,
    hasGmailAppPassword: !!user.gmailAppPasswordEnc,
    gmailOauthEmail: user.gmailOauthEmail,
    hasGoogleOAuth: !!user.googleRefreshTokenEnc,
    resumeFilename: user.resumeFilename,
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

usersRouter.post("/me/resume", upload.single("resume"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  fs.writeFileSync(resumePathFor(req.user!.id), req.file.buffer);
  const filename = req.file.originalname;
  await prisma.user.update({ where: { id: req.user!.id }, data: { resumeFilename: filename } });
  res.json({ resumeFilename: filename });
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
