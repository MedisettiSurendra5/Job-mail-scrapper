import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { encrypt } from "./crypto";
import { env } from "./env";
import { storageStatePath } from "./paths";

// A verified, logged-in Playwright storageState lets the shared JobRight
// login start warm instead of re-deriving the login flow from scratch, which
// hits JobRight's real login form and is far more likely to trip anti-bot
// checks than reusing a known-good session.
//
// The data volume is the canonical location: it is the only path that exists
// identically in dev and in the container, and it is where the runtime writes
// the session back after every successful task. The repo-root file the old
// jobright_automation.py produced is kept as a dev-only fallback - it is
// gitignored and .dockerignored, so it can never reach production.
const REPO_ROOT_STATE_FILE = path.join(__dirname, "..", "..", "jobright_state.json");

function readSeedStorageState(): string | null {
  for (const file of [storageStatePath, REPO_ROOT_STATE_FILE]) {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  }
  return null;
}

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

  if (jrConfig && !jrConfig.storageStateJson) {
    const storageStateJson = readSeedStorageState();
    if (storageStateJson) {
      await prisma.jobRightConfig.update({ where: { id: 1 }, data: { storageStateJson } });
      console.log("Seeded JobRight session from an existing jobright_state.json");
    } else {
      console.warn(
        `No JobRight session found - drop a logged-in Playwright storageState at ${storageStatePath} ` +
          "to avoid a fresh interactive login on the next task."
      );
    }
  }
}
