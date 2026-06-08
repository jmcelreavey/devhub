"use client";

import { useCallback } from "react";
import { Circle, CheckCircle2, ExternalLink } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";

interface TaskRefBlockViewProps {
  taskId: string;
  date: string;
  label: string;
}

interface DayTask {
  id: string;
  text: string;
  done: boolean;
}

interface DayResponse {
  date: string;
  tasks: DayTask[];
}

/**
 * A checkbox bound to a real task in `tasks/{date}.json`. Reflects the task's
 * done state (polled) and toggling it flips the task — so completing the task
 * anywhere ticks this checkbox, and vice versa.
 */
export function TaskRefBlockView({ taskId, date, label }: TaskRefBlockViewProps) {
  const { data, mutate } = useLive<DayResponse>(`/api/tasks/history?date=${date}`, {
    refreshInterval: 15_000,
  });
  const toast = useToast();
  const task = data?.tasks.find((t) => t.id === taskId);
  const done = task?.done ?? false;
  const missing = !!data && !task;

  const toggle = useCallback(async () => {
    if (!task) return;
    await mutate(
      (cur) =>
        cur
          ? { ...cur, tasks: cur.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) }
          : cur,
      { revalidate: false },
    );
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, date, done: !done }),
      });
      if (!res.ok) throw new Error(await res.text());
      await mutate();
    } catch (e) {
      console.error("toggle task ref:", e);
      await mutate();
      toast.error("Couldn't update task.");
    }
  }, [task, taskId, date, done, mutate, toast]);

  return (
    <div
      className="group flex items-center gap-2 my-0.5"
      contentEditable={false}
      style={{ opacity: missing ? 0.5 : 1 }}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={missing}
        aria-label={done ? "Mark task incomplete" : "Mark task complete"}
        style={{ background: "none", border: "none", cursor: missing ? "default" : "pointer", padding: 0, display: "flex" }}
      >
        {done ? (
          <CheckCircle2 size={16} style={{ color: "var(--success)" }} aria-hidden />
        ) : (
          <Circle size={16} style={{ color: "var(--text-subtle)" }} aria-hidden />
        )}
      </button>
      <span
        className="text-sm"
        style={{
          color: done ? "var(--text-subtle)" : "var(--text)",
          textDecoration: done ? "line-through" : "none",
        }}
      >
        {task?.text ?? label}
      </span>
      <a
        href="/tasks"
        className="hub-icon-btn opacity-0 group-hover:opacity-100"
        title="Open in Tasks"
        aria-label="Open in Tasks"
        contentEditable={false}
      >
        <ExternalLink size={11} aria-hidden />
      </a>
      {missing && (
        <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
          (task removed)
        </span>
      )}
    </div>
  );
}
