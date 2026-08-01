import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { getEffectivePlan } from "../billing";
import { runTrackerSyncNow, startTrackerSync, stopTrackerSync } from "../scheduler";

export const trackerRouter = Router();
trackerRouter.use(requireAuth);

trackerRouter.get("/", async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const applications = await prisma.trackedApplication.findMany({
    where: { userId: user.id },
    orderBy: { lastEmailAt: "desc" },
    take: 50,
  });
  res.json({ enabled: user.trackerEnabled, lastSyncAt: user.trackerLastSyncAt, applications });
});

const enableSchema = z.object({ enabled: z.boolean() });

trackerRouter.put("/enable", async (req, res) => {
  const parsed = enableSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

  if (parsed.data.enabled) {
    if (getEffectivePlan(user) === "free") {
      return res.status(403).json({ error: "Upgrade to Pro or Elite to enable the Application Tracker" });
    }
    if (!user.googleRefreshTokenEnc) {
      return res.status(400).json({ error: "Connect Gmail (OAuth) from your Profile page first" });
    }
  }

  await prisma.user.update({ where: { id: user.id }, data: { trackerEnabled: parsed.data.enabled } });

  if (parsed.data.enabled) {
    startTrackerSync(user.id);
    await runTrackerSyncNow(user.id);
  } else {
    stopTrackerSync(user.id);
  }

  res.json({ enabled: parsed.data.enabled });
});

trackerRouter.post("/sync", async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.trackerEnabled) return res.status(400).json({ error: "Enable the Application Tracker first" });

  const task = await runTrackerSyncNow(user.id);
  res.json({ taskId: task.id });
});
