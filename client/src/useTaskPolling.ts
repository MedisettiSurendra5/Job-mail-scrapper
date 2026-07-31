import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Task } from "./api";

const POLL_INTERVAL_MS = 2500;
// Matches (with slack) the server-side per-task watchdog in taskQueue.ts, so
// a wedged task always settles server-side before this gives up client-side.
const MAX_POLL_MS = 12 * 60 * 1000;

// Polls a queued task until it settles (done/failed), then calls onSettled.
export function usePollTask(onSettled?: (task: Task) => void) {
  const [tasks, setTasks] = useState<Record<number, Task>>({});
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  function watch(taskId: number, type: Task["type"]) {
    const startedAt = Date.now();
    const poll = async () => {
      if (Date.now() - startedAt > MAX_POLL_MS) {
        const timedOut: Task = { id: taskId, type, status: "failed", error: "Timed out waiting for a response - please refresh and check the job list." };
        setTasks((prev) => ({ ...prev, [taskId]: timedOut }));
        onSettledRef.current?.(timedOut);
        return;
      }
      try {
        const { task } = await api.get<{ task: Task }>(`/tasks/${taskId}`);
        setTasks((prev) => ({ ...prev, [taskId]: task }));
        if (task.status === "done" || task.status === "failed") {
          onSettledRef.current?.(task);
          return;
        }
      } catch {
        // Transient network hiccup (or a single timed-out poll) - keep
        // retrying rather than abandoning the watch silently; MAX_POLL_MS
        // above still bounds the total wait.
      }
      timers.current[taskId] = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
  }

  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const t = timers.current;
    return () => {
      Object.values(t).forEach(clearTimeout);
    };
  }, []);

  return { tasks, watch };
}
