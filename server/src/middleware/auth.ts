import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db";
import { env } from "../env";

export interface AuthUser {
  id: number;
  email: string;
  role: "admin" | "member";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const COOKIE_NAME = "auth_token";

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.jwtSecret, { expiresIn: "30d" });
}

export function setAuthCookie(res: Response, user: AuthUser) {
  res.cookie(COOKIE_NAME, signToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(COOKIE_NAME);
}

// A JWT alone can't be revoked, so a lock wouldn't actually take effect
// until the token naturally expired (up to 30 days) without this check -
// the extra lookup by primary key is cheap and keeps "locked" meaning
// "cut off now", not just "can't start a new session".
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  let authUser: AuthUser;
  try {
    authUser = jwt.verify(token, env.jwtSecret) as AuthUser;
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
  const user = await prisma.user.findUnique({ where: { id: authUser.id }, select: { locked: true } });
  if (!user || user.locked) {
    clearAuthCookie(res);
    return res.status(401).json({ error: "This account has been locked. Contact your admin." });
  }
  req.user = authUser;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}
