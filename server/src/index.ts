import path from "path";
import cookieParser from "cookie-parser";
import express from "express";
import { env } from "./env";
import { ensureDataDirs } from "./paths";
import { seed } from "./seed";
import { startQueues } from "./queue";
import { initScheduler } from "./scheduler";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { adminRouter } from "./routes/admin";
import { jobsRouter } from "./routes/jobs";
import { contactsRouter } from "./routes/contacts";
import { tasksRouter } from "./routes/tasks";
import { automationRulesRouter } from "./routes/automationRules";
import { billingRouter } from "./routes/billing";

async function main() {
  ensureDataDirs();
  await seed();
  await startQueues();
  await initScheduler();

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/api/contacts", contactsRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/admin/automation-rules", automationRulesRouter);
  app.use("/api/billing", billingRouter);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Serve the built React app (multi-stage Docker build copies it here).
  const clientDist = path.join(__dirname, "public");
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  app.listen(env.port, () => {
    console.log(`Server listening on port ${env.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
