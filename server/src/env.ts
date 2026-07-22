import path from "path";
import dotenv from "dotenv";

// Reuse the single project-root .env regardless of whether this runs from
// server/src (dev, via tsx) or server/dist (prod, after build) - both sit
// two directories below the repo root.
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

// Resolve to an absolute path up front. Prisma's CLI (migrate/generate)
// resolves a relative sqlite `file:` URL against prisma/schema.prisma's
// directory, while the generated client resolves it differently at
// runtime - the two disagree on where a relative path points. Using an
// absolute path here sidesteps that mismatch entirely, and DATABASE_URL is
// set (if not already provided) before any Prisma Client is constructed.
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${path.join(dataDir, "app.db")}`;
}

export const env = {
  port: parseInt(process.env.PORT || "4000", 10),
  jwtSecret: required("JWT_SECRET"),
  encryptionKey: required("ENCRYPTION_KEY"),
  dataDir,
  headless: (process.env.HEADLESS ?? "true").toLowerCase() !== "false",
  // Optional one-time seed for the shared JobRight login + Gmail sending,
  // so an admin doesn't have to hand-type them into the UI on first boot.
  seedJobrightEmail: process.env.JOBRIGHT_EMAIL,
  seedJobrightPassword: process.env.JOBRIGHT_PASSWORD,
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL,
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD,
  // Optional - only needed if a member uses "Connect Gmail" (OAuth) in their
  // profile instead of a manual address + app password.
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
};
