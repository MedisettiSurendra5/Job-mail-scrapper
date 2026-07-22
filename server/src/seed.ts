import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { encrypt } from "./crypto";
import { env } from "./env";

// The old jobright_automation.py script already has a verified, logged-in
// Playwright storageState (jobright_state.json) at the repo root. Seed it in
// directly so the shared login starts warm instead of re-deriving the login
// flow from scratch (which hits JobRight's real login form and is more
// fragile / more likely to trip anti-bot checks than reusing a known-good
// session).
const LEGACY_STATE_FILE = path.join(__dirname, "..", "..", "jobright_state.json");

// First-boot convenience: create the initial admin account and seed the
// shared JobRight login from the old .env values, if they're present and
// nothing has been configured yet through the UI. Safe to run every boot.
export async function seed() {
  await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1, dryRun: true },
    update: {},
  });

  const userCount = await prisma.user.count();
  if (userCount === 0 && env.seedAdminEmail && env.seedAdminPassword) {
    const passwordHash = await bcrypt.hash(env.seedAdminPassword, 12);
    await prisma.user.create({
      data: { email: env.seedAdminEmail.toLowerCase(), passwordHash, role: "admin" },
    });
    console.log(`Seeded initial admin account: ${env.seedAdminEmail}`);
  }

  let jrConfig = await prisma.jobRightConfig.findUnique({ where: { id: 1 } });
  if (!jrConfig && env.seedJobrightEmail && env.seedJobrightPassword) {
    jrConfig = await prisma.jobRightConfig.create({
      data: { id: 1, email: env.seedJobrightEmail, passwordEnc: encrypt(env.seedJobrightPassword) },
    });
    console.log("Seeded shared JobRight login from env vars");
  }

  if (jrConfig && !jrConfig.storageStateJson && fs.existsSync(LEGACY_STATE_FILE)) {
    const storageStateJson = fs.readFileSync(LEGACY_STATE_FILE, "utf8");
    await prisma.jobRightConfig.update({ where: { id: 1 }, data: { storageStateJson } });
    console.log("Seeded JobRight session from existing jobright_state.json");
  }
}
