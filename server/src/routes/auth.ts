import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../db";
import { clearAuthCookie, requireAuth, setAuthCookie } from "../middleware/auth";
import { encrypt } from "../crypto";
import { env } from "../env";
import { buildGoogleAuthUrl, emailFromIdToken, exchangeCodeForTokens } from "../automation/googleOAuth";
import { Role } from "../types";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid email/password" });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }
  if (user.locked) {
    return res.status(403).json({ error: "This account has been locked. Contact your admin." });
  }

  const authUser = { id: user.id, email: user.email, role: user.role as Role };
  setAuthCookie(res, authUser);
  res.json({ user: authUser });
});

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// "Connect Gmail" (OAuth) - a full-page-redirect flow, not a fetch, so the
// existing auth_token cookie already scopes both these routes to the
// logged-in user. `state` is a short-lived JWT binding the flow to that same
// user id, re-verified in the callback - standard OAuth CSRF protection
// (stops a forged/replayed callback from attaching tokens to someone else's
// account).
authRouter.get("/google/connect", requireAuth, (req, res) => {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
    return res.status(501).json({ error: "Google OAuth is not configured on this server" });
  }
  const state = jwt.sign({ uid: req.user!.id }, env.jwtSecret, { expiresIn: "10m" });
  res.redirect(buildGoogleAuthUrl(state));
});

authRouter.get("/google/callback", requireAuth, async (req, res) => {
  const { code, state, error } = req.query;
  if (error || typeof code !== "string") return res.redirect("/profile?gmail_oauth=denied");

  try {
    const payload = jwt.verify(String(state), env.jwtSecret) as { uid: number };
    if (payload.uid !== req.user!.id) throw new Error("state mismatch");
  } catch {
    return res.status(400).send("Invalid or expired OAuth state");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const email = tokens.id_token ? emailFromIdToken(tokens.id_token) : null;

    const existing = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!tokens.refresh_token && !existing.googleRefreshTokenEnc) {
      // Shouldn't happen with prompt=consent, but with no refresh token at
      // all (neither new nor already stored) there's nothing to send with -
      // treat as a failed connect rather than a silent no-op "success".
      return res.redirect("/profile?gmail_oauth=error");
    }

    const data: { gmailOauthEmail?: string; googleRefreshTokenEnc?: string } = {};
    if (email) data.gmailOauthEmail = email;
    if (tokens.refresh_token) data.googleRefreshTokenEnc = encrypt(tokens.refresh_token);
    await prisma.user.update({ where: { id: req.user!.id }, data });

    res.redirect("/profile?gmail_oauth=connected");
  } catch {
    res.redirect("/profile?gmail_oauth=error");
  }
});
