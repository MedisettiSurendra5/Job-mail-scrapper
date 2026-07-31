import { prisma } from "../db";
import { sanitizeErrorMessage } from "../sanitize";
import { TaskType } from "../types";

type Handler = (payload: any, taskId: number) => Promise<void>;

// A small in-process queue backed by the Task table (so status survives a
// restart). Concurrency is capped per-queue - the jobright queue must stay
// at 1 since only one browser session should drive the shared login at a
// time; the email queue can run a couple of sends in parallel.
export class TaskQueue {
  private handlers = new Map<TaskType, Handler>();
  private pending: number[] = [];
  private activeCount = 0;

  constructor(private concurrency: number, private timeoutMs = 10 * 60 * 1000) {}

  register(type: TaskType, handler: Handler) {
    this.handlers.set(type, handler);
  }

  async enqueue(type: TaskType, payload: unknown, requestedBy?: number) {
    const task = await prisma.task.create({
      data: { type, payload: JSON.stringify(payload), requestedBy },
    });
    this.pending.push(task.id);
    this.pump();
    return task;
  }

  // Re-queue anything left queued/running from a previous process exit.
  async resume() {
    const stuck = await prisma.task.findMany({
      where: { status: { in: ["queued", "running"] }, type: { in: [...this.handlers.keys()] } },
      orderBy: { id: "asc" },
    });
    for (const t of stuck) {
      if (t.status === "running") {
        await prisma.task.update({ where: { id: t.id }, data: { status: "queued" } });
      }
      this.pending.push(t.id);
    }
    this.pump();
  }

  private pump() {
    while (this.activeCount < this.concurrency && this.pending.length) {
      const id = this.pending.shift()!;
      this.activeCount++;
      this.run(id).finally(() => {
        this.activeCount--;
        this.pump();
      });
    }
  }

  private async run(taskId: number) {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.status === "done") return;
    const handler = this.handlers.get(task.type as TaskType);
    if (!handler) return;

    await prisma.task.update({ where: { id: taskId }, data: { status: "running", startedAt: new Date() } });

    // A wedged handler (e.g. a stalled Playwright page) must not block this
    // concurrency-1 queue forever - race it against a watchdog timeout. The
    // handler keeps running in the background if it loses the race; its
    // eventual settlement is caught below so it can't crash the process.
    const handlerPromise = handler(JSON.parse(task.payload), taskId);
    handlerPromise.catch(() => {});
    let timer: ReturnType<typeof setTimeout>;

    try {
      await Promise.race([
        handlerPromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Task timed out after ${Math.round(this.timeoutMs / 1000)}s`)), this.timeoutMs);
        }),
      ]);
      await prisma.task.update({ where: { id: taskId }, data: { status: "done", finishedAt: new Date() } });
    } catch (e: any) {
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "failed", error: sanitizeErrorMessage(String(e?.message || e)), finishedAt: new Date() },
      });
    } finally {
      clearTimeout(timer!);
    }
  }
}
