import path from "path";
import fs from "fs";
import { env } from "./env";

export const resumesDir = path.join(env.dataDir, "resumes");
export const storageStatePath = path.join(env.dataDir, "jobright_storage_state.json");

export function ensureDataDirs() {
  fs.mkdirSync(resumesDir, { recursive: true });
}

export function resumePathFor(userId: number): string {
  return path.join(resumesDir, `${userId}.pdf`);
}
