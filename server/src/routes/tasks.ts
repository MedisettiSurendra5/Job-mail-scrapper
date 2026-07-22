import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

tasksRouter.get("/:id", async (req, res) => {
  const task = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ task });
});
