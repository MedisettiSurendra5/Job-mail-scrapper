import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Task } from "./api";

// Polls a queued task until it settles (done/failed), then calls onSettled.
export function usePollTask(onSettled?: (task: Task) => void) {
  const [tasks, setTasks] = useState<Record<number, Task>>({});
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  function watch(taskId: number) {
    const poll = async () => {
      try {
        const { task } = await api.get<{ task: Task }>(`/tasks/${taskId}`);
        setTasks((prev) => ({ ...prev, [taskId]: task }));
        if (task.status === "done" || task.status === "failed") {
          onSettledRef.current?.(task);
          return;
        }
      } catch {
        return;
      }
      timers.current[taskId] = setTimeout(poll, 2500);
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
