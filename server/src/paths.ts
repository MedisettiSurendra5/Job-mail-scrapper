import path from "path";
import fs from "fs";
import { env } from "./env";

export const resumesDir = path.join(env.dataDir, "resumes");
// Lives on the data volume rather than in the image, so a warm JobRight
// session survives rebuilds and can be replaced by dropping a file on the
// host. Named to match the file the old jobright_automation.py writes, so an
// existing session can be copied straight in.
export const storageStatePath = path.join(env.dataDir, "jobright_state.json");

export function ensureDataDirs() {
  fs.mkdirSync(resumesDir, { recursive: true });
}

export function resumePathFor(resumeId: number): string {
  return path.join(resumesDir, `${resumeId}.pdf`);
}
