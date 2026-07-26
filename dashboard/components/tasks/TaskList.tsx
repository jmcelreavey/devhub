"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { isTaskOpen, type Task } from "@/lib/tasks/types";
import {
  rewriteTaskKey,
  detectBareUrl,
  clearedLineForToday,
  matchesTaskSearch,
} from "@/lib/tasks/task-text";
import { TaskItem } from "@/components/tasks/TaskItem";
import { Plus, CheckCircle2, Link as LinkIcon, ChevronRight, ChevronDown } from "lucide-react";
import { useToast } from "@/lib/hooks/use-toast";
import { useLive } from "@/lib/hooks/use-fetch";
import { AddToJiraModal } from "@/components/tasks/AddToJiraModal";
import { JiraTransitionModal } from "@/components/jira/JiraTransitionModal";
import { SortableList } from "@/components/ui/SortableList";
import { useGridSize } from "@/lib/hooks/use-grid-size";
import { todayISO } from "@/lib/utils";

// Task now lives in lib/tasks/types.ts, shared with the server storage layer.
// It was duplicated here and had drifted (missing rolledFromId/rolledFromDate).
// Re-exported so existing `import type { Task } from "@/components/tasks/TaskList"`
// callers keep working.
export type { Task } from "@/lib/tasks/types";
export { matchesTaskSearch } from "@/lib/tasks/task-text";
export { renderTaskTextContent } from "@/components/tasks/TaskText";
export { TaskItem } from "@/components/tasks/TaskItem";

interface JiraStatus {
  name: string;
}

const EMPTY_TASKS: Task[] = [];


export interface TaskListProps {
  inputId?: string;
  searchQuery?: string;
  /** Hide specific open tasks (e.g. the one already shown in the NOW card). */
  excludeIds?: readonly string[];
}

export function TaskList({ inputId = "task-add-text", searchQuery, excludeIds }: TaskListProps) {
  const { data, error, isLoading, mutate } = useLive<{ tasks?: Task[] }>("/api/tasks");
  const gridSize = useGridSize("main");
  const tasks = data?.tasks ?? EMPTY_TASKS;
  const [newText, setNewText] = useState("");
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set());
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const [linkName, setLinkName] = useState("");
  const [jiraStatuses, setJiraStatuses] = useState<Record<string, JiraStatus>>({});
  const [jiraModalTask, setJiraModalTask] = useState<Task | null>(null);
  const [transitionPrompt, setTransitionPrompt] = useState<{
    task: Task;
    action: "complete" | "abandon";
    reason?: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const linkNameRef = useRef<HTMLInputElement>(null);
  const loadErrorToastShown = useRef(false);
  const toast = useToast();
  const today = todayISO();

  const hasCompletedToday = tasks.some((t) => t.done && t.completedAt?.startsWith(today));
  const hasAbandonedToday = tasks.some((t) => t.abandonedAt?.startsWith(today));
  const [showCompleted, setShowCompleted] = useState(hasCompletedToday);
  const [showAbandoned, setShowAbandoned] = useState(hasAbandonedToday);
  const autoExpandedCompletedRef = useRef(false);
  const autoExpandedAbandonedRef = useRef(false);

  useEffect(() => {
    if (autoExpandedCompletedRef.current || !hasCompletedToday) return;
    autoExpandedCompletedRef.current = true;
    setShowCompleted(true);
  }, [hasCompletedToday]);

  useEffect(() => {
    if (autoExpandedAbandonedRef.current || !hasAbandonedToday) return;
    autoExpandedAbandonedRef.current = true;
    setShowAbandoned(true);
  }, [hasAbandonedToday]);

  useEffect(() => {
    if (!error) {
      loadErrorToastShown.current = false;
      return;
    }
    if (loadErrorToastShown.current) return;
    loadErrorToastShown.current = true;
    console.error("load tasks:", error);
    toast.error("Couldn't load tasks.");
  }, [error, toast]);

  useEffect(() => {
    const keys = tasks
      .filter((t) => t.jiraKey && isTaskOpen(t))
      .map((t) => t.jiraKey!)
      .filter((k) => !jiraStatuses[k]);

    if (keys.length === 0) return;

    Promise.all(
      keys.map((key) =>
        fetch(`/api/jira/ticket/${key}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => (d ? { key, status: d.status } : null))
          .catch(() => null),
      ),
    ).then((results) => {
      const newStatuses: Record<string, JiraStatus> = {};
      for (const r of results) {
        if (r) newStatuses[r.key] = r.status;
      }
      if (Object.keys(newStatuses).length > 0) {
        setJiraStatuses((prev) => ({ ...prev, ...newStatuses }));
      }
    });
  }, [tasks, jiraStatuses]);

  const handleInputChange = useCallback((value: string) => {
    setNewText(value);
    const url = detectBareUrl(value);
    if (url) {
      setDetectedUrl(url);
    } else {
      setDetectedUrl(null);
      setLinkName("");
    }
  }, []);

  const confirmLink = useCallback(() => {
    if (!detectedUrl || !linkName.trim()) return;
    const mdLink = `[${linkName.trim()}](${detectedUrl})`;
    setNewText((prev) => prev.replace(detectedUrl, mdLink));
    setDetectedUrl(null);
    setLinkName("");
    inputRef.current?.focus();
  }, [detectedUrl, linkName]);

  const dismissLinkPrompt = useCallback(() => {
    setDetectedUrl(null);
    setLinkName("");
    inputRef.current?.focus();
  }, []);

  const addTask = useCallback(async () => {
    const text = newText.trim();
    if (!text) return;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(await res.text());
      const task = (await res.json()) as Task;
      setNewText("");
      setDetectedUrl(null);
      setLinkName("");
      await mutate(
        (cur) => ({
          ...(cur ?? {}),
          tasks: [...(cur?.tasks ?? []), task],
        }),
        { revalidate: false },
      );
      inputRef.current?.focus();
    } catch (e) {
      console.error("add task:", e);
      toast.error("Couldn't add task.");
    }
  }, [newText, toast, mutate]);

  const toggleTask = useCallback(
    async (id: string) => {
      const original = tasks.find((t) => t.id === id);
      if (!original) return;
      await mutate(
        (cur) => ({
          ...(cur ?? {}),
          tasks: (cur?.tasks ?? []).map((t) =>
            t.id === id
              ? {
                  ...t,
                  done: !t.done,
                  completedAt: !t.done ? new Date().toISOString() : undefined,
                  abandonedAt: !t.done ? undefined : t.abandonedAt,
                  abandonReason: !t.done ? undefined : t.abandonReason,
                }
              : t,
          ),
        }),
        { revalidate: false },
      );
      try {
        const res = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, done: true }),
        });
        if (!res.ok) throw new Error(await res.text());
        const updated = (await res.json()) as Task;
        await mutate(
          (cur) => ({
            ...(cur ?? {}),
            tasks: (cur?.tasks ?? []).map((t) => (t.id === id ? updated : t)),
          }),
          { revalidate: false },
        );
      } catch (e) {
        console.error("toggle task:", e);
        await mutate(
          (cur) => ({
            ...(cur ?? {}),
            tasks: (cur?.tasks ?? []).map((t) => (t.id === id ? original : t)),
          }),
          { revalidate: false },
        );
        toast.error("Couldn't update task.");
      }
    },
    [tasks, mutate, toast],
  );

  const toggleTimer = useCallback(
    async (id: string) => {
      const target = tasks.find((t) => t.id === id);
      if (!target) return;
      const starting = !target.timerStartedAt;
      const now = Date.now();
      await mutate(
        (cur) => ({
          ...(cur ?? {}),
          tasks: (cur?.tasks ?? []).map((t) => {
            // Settle any running timer (the toggled task when stopping, or others when starting single-active).
            if (t.timerStartedAt && (t.id === id ? !starting : starting)) {
              const elapsed = Math.max(0, now - Date.parse(t.timerStartedAt));
              return { ...t, timeSpentMs: (t.timeSpentMs ?? 0) + elapsed, timerStartedAt: undefined };
            }
            if (t.id === id && starting) {
              return { ...t, timerStartedAt: new Date(now).toISOString() };
            }
            return t;
          }),
        }),
        { revalidate: false },
      );
      try {
        const res = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, timer: starting ? "start" : "stop" }),
        });
        if (!res.ok) throw new Error(await res.text());
        // Revalidate to pick up server-side single-active settlement of other tasks.
        await mutate();
      } catch (e) {
        console.error("toggle timer:", e);
        await mutate();
        toast.error("Couldn't update timer.");
      }
    },
    [tasks, mutate, toast],
  );

  const updateTaskText = useCallback(
    async (id: string, text: string) => {
      try {
        const res = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, text }),
        });
        if (!res.ok) throw new Error(await res.text());
        const updated = (await res.json()) as Task;
        await mutate(
          (cur) => ({
            ...(cur ?? {}),
            tasks: (cur?.tasks ?? []).map((t) => (t.id === id ? updated : t)),
          }),
          { revalidate: false },
        );
      } catch (e) {
        console.error("update task:", e);
        toast.error("Couldn't update task.");
      }
    },
    [mutate, toast],
  );

  const abandonTask = useCallback(
    async (id: string, reason?: string) => {
      const original = tasks.find((t) => t.id === id);
      if (!original) return;
      await mutate(
        (cur) => ({
          ...(cur ?? {}),
          tasks: (cur?.tasks ?? []).map((t) =>
            t.id === id
              ? {
                  ...t,
                  done: false,
                  completedAt: undefined,
                  abandonedAt: new Date().toISOString(),
                  abandonReason: reason || undefined,
                }
              : t,
          ),
        }),
        { revalidate: false },
      );
      try {
        const res = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status: "abandoned", abandonReason: reason }),
        });
        if (!res.ok) throw new Error(await res.text());
        const updated = (await res.json()) as Task;
        await mutate(
          (cur) => ({
            ...(cur ?? {}),
            tasks: (cur?.tasks ?? []).map((t) => (t.id === id ? updated : t)),
          }),
          { revalidate: false },
        );
      } catch (e) {
        console.error("abandon task:", e);
        await mutate(
          (cur) => ({
            ...(cur ?? {}),
            tasks: (cur?.tasks ?? []).map((t) => (t.id === id ? original : t)),
          }),
          { revalidate: false },
        );
        toast.error("Couldn't abandon task.");
      }
    },
    [tasks, mutate, toast],
  );

  const reactivateTask = useCallback(
    async (id: string) => {
      const original = tasks.find((t) => t.id === id);
      if (!original) return;
      await mutate(
        (cur) => ({
          ...(cur ?? {}),
          tasks: (cur?.tasks ?? []).map((t) =>
            t.id === id
              ? { ...t, abandonedAt: undefined, abandonReason: undefined }
              : t,
          ),
        }),
        { revalidate: false },
      );
      try {
        const res = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, text: original.text }),
        });
        if (!res.ok) throw new Error(await res.text());
        const updated = (await res.json()) as Task;
        await mutate(
          (cur) => ({
            ...(cur ?? {}),
            tasks: (cur?.tasks ?? []).map((t) => (t.id === id ? updated : t)),
          }),
          { revalidate: false },
        );
      } catch (e) {
        console.error("reactivate task:", e);
        await mutate(
          (cur) => ({
            ...(cur ?? {}),
            tasks: (cur?.tasks ?? []).map((t) => (t.id === id ? original : t)),
          }),
          { revalidate: false },
        );
        toast.error("Couldn't reactivate task.");
      }
    },
    [tasks, mutate, toast],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      const removed = tasks.find((t) => t.id === id);
      if (!removed) return;
      await mutate(
        (cur) => ({
          ...(cur ?? {}),
          tasks: (cur?.tasks ?? []).filter((t) => t.id !== id),
        }),
        { revalidate: false },
      );
      try {
        const res = await fetch("/api/tasks", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok && res.status !== 404) throw new Error(await res.text());
      } catch (e) {
        console.error("delete task:", e);
        await mutate(
          (cur) => ({
            ...(cur ?? {}),
            tasks,
          }),
          { revalidate: false },
        );
        toast.error("Couldn't delete task.");
        return;
      }

      toast.info("Task deleted.", {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              const body: { text: string; due?: string } = { text: removed.text };
              if (removed.due) body.due = removed.due;
              const res = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              if (!res.ok) throw new Error(await res.text());
              const task = (await res.json()) as Task;
              await mutate(
                (cur) => ({
                  ...(cur ?? {}),
                  tasks: [...(cur?.tasks ?? []), task],
                }),
                { revalidate: false },
              );
            } catch (err) {
              console.error("undo delete:", err);
              toast.error("Couldn't restore task.");
            }
          },
        },
      });
    },
    [tasks, mutate, toast],
  );

  const reorderTasks = useCallback(
    async (orderedOpenTasks: Task[]) => {
      const previousTasks = tasks;
      const orderedIds = orderedOpenTasks.map((task) => task.id);
      let openIndex = 0;
      const optimisticTasks = tasks.map((task) =>
        isTaskOpen(task) ? (orderedOpenTasks[openIndex++] ?? task) : task,
      );

      await mutate(
        (cur) => ({
          ...(cur ?? {}),
          tasks: optimisticTasks,
        }),
        { revalidate: false },
      );

      try {
        const res = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: orderedIds }),
        });
        if (!res.ok) throw new Error(await res.text());
        const updated = (await res.json()) as { tasks?: Task[] };
        await mutate(
          (cur) => ({
            ...(cur ?? {}),
            tasks: updated.tasks ?? optimisticTasks,
          }),
          { revalidate: false },
        );
      } catch (e) {
        console.error("reorder tasks:", e);
        await mutate(
          (cur) => ({
            ...(cur ?? {}),
            tasks: previousTasks,
          }),
          { revalidate: false },
        );
        toast.error("Couldn't reorder tasks.");
      }
    },
    [tasks, mutate, toast],
  );

  const q = searchQuery?.toLowerCase() ?? "";

  const pending = tasks.filter(
    (t) => isTaskOpen(t) && matchesTaskSearch(t, q) && !excludeIds?.includes(t.id),
  );
  const completed = tasks.filter((t) => t.done && matchesTaskSearch(t, q));
  const abandoned = tasks.filter((t) => !!t.abandonedAt && matchesTaskSearch(t, q));

  // Completion reads as departure, not teleport: the row holds briefly so
  // the check animation lands, then height-collapses out before the data
  // update moves it into Done.
  const completeWithExit = useCallback(
    (id: string) => {
      setExitingIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      window.setTimeout(() => {
        setExitingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        void toggleTask(id);
      }, 440);
    },
    [toggleTask],
  );

  // Completing/abandoning a Jira-linked task first offers a state change.
  const requestComplete = useCallback(
    (task: Task) => {
      if (task.jiraKey) setTransitionPrompt({ task, action: "complete" });
      else completeWithExit(task.id);
    },
    [completeWithExit],
  );

  const requestAbandon = useCallback(
    (task: Task, reason?: string) => {
      if (task.jiraKey) setTransitionPrompt({ task, action: "abandon", reason });
      else abandonTask(task.id, reason);
    },
    [abandonTask],
  );

  // Apply the chosen transition (if any), then finalize the local task change.
  const resolveTransition = useCallback(
    async (transitionId: string | null) => {
      const prompt = transitionPrompt;
      if (!prompt) return;
      setTransitionPrompt(null);
      if (transitionId && prompt.task.jiraKey) {
        try {
          const res = await fetch(`/api/jira/ticket/${prompt.task.jiraKey}/transition`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transitionId }),
          });
          if (!res.ok) throw new Error(await res.text());
        } catch (e) {
          console.error("apply transition:", e);
          toast.error("Couldn't update the Jira state, but the task was updated.");
        }
      }
      if (prompt.action === "complete") completeWithExit(prompt.task.id);
      else abandonTask(prompt.task.id, prompt.reason);
    },
    [transitionPrompt, completeWithExit, abandonTask, toast],
  );

  // Re-fetch one ticket's status so the pill reflects Jira after a change.
  const refreshJiraStatus = useCallback(async (key: string) => {
    try {
      const res = await fetch(`/api/jira/ticket/${key}`);
      if (!res.ok) return;
      const d = (await res.json()) as { status?: JiraStatus };
      if (d.status) setJiraStatuses((prev) => ({ ...prev, [key]: d.status! }));
    } catch (e) {
      console.error("refresh jira status:", e);
    }
  }, []);

  // After a ticket is created, point the task at the new key.
  const handleJiraCreated = useCallback(
    (task: Task, newKey: string) => {
      const newText = rewriteTaskKey(task.text, task.jiraKey, newKey);
      if (newText !== task.text) void updateTaskText(task.id, newText);
    },
    [updateTaskText],
  );

  const renderPendingTasks = () => (
    <SortableList
      items={pending}
      getId={(task) => task.id}
      disabled={!!q}
      onReorder={reorderTasks}
      renderItem={(task, { dragHandleProps, isDragging, isDropTarget }) => {
        const exiting = exitingIds.has(task.id);
        return (
          <div className={exiting ? "task-exit" : undefined}>
            <TaskItem
              task={exiting ? { ...task, done: true } : task}
              jiraStatus={task.jiraKey ? jiraStatuses[task.jiraKey] : undefined}
              dragHandleProps={q || exiting ? undefined : dragHandleProps}
              isDragging={isDragging}
              isDropTarget={isDropTarget}
              onToggle={() => {
                if (!exiting) requestComplete(task);
              }}
              onDelete={() => deleteTask(task.id)}
              onEdit={(text) => updateTaskText(task.id, text)}
              onAbandon={(reason) => requestAbandon(task, reason)}
              onAddToJira={() => setJiraModalTask(task)}
              onStatusClick={task.jiraKey ? () => refreshJiraStatus(task.jiraKey!) : undefined}
              onTimer={() => toggleTimer(task.id)}
            />
          </div>
        );
      }}
    />
  );

  if (isLoading && !data) {
    return (
      <div className="space-y-2">
        <div className="skeleton" style={{ height: "36px" }} />
        <div className="skeleton" style={{ height: "28px", width: "80%" }} />
        <div className="skeleton" style={{ height: "28px", width: "60%" }} />
      </div>
    );
  }

  // 1x1 compact: in-flight task + count chips
  if (gridSize === "1x1") {
    const inFlight = pending.find((t) => t.jiraKey);
    return (
      <div className="space-y-2 px-2 py-1">
        {inFlight && (
          <div className="truncate text-[13px] text-text">{inFlight.text}</div>
        )}
        <div className="flex gap-2 text-[11px] font-mono tabular-nums text-text-subtle">
          {pending.length > 0 && <span>+{pending.length} todo</span>}
          {completed.length > 0 && <span>✓{completed.length} done</span>}
        </div>
      </div>
    );
  }

  // 2x1 medium: in-flight + open tasks; Done collapsed to chip
  if (gridSize === "2x1") {
    return (
      <div className="space-y-2">
        {renderPendingTasks()}
        {completed.length > 0 && (
          <div className="text-[11px] font-mono text-text-subtle">
            ✓ {completed.length} done
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(pending.length + completed.length + abandoned.length) > 0 && (
        <SegmentedProgressBar open={pending.length} done={completed.length} abandoned={abandoned.length} />
      )}

      <div className="task-add-row">
        <label htmlFor={inputId} className="sr-only">
          Add a task
        </label>
        <input
          id={inputId}
          ref={inputRef}
          className="input task-add-text"
          placeholder="Add a task… (paste a link or Jira key)"
          value={newText}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const currentText = (e.target as HTMLInputElement).value;
            const freshUrl = detectedUrl || detectBareUrl(currentText);
            if (freshUrl && linkName.trim()) {
              e.preventDefault();
              confirmLink();
            } else if (freshUrl) {
              e.preventDefault();
              setDetectedUrl(freshUrl);
              setNewText(currentText);
            } else {
              addTask();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-ghost task-add-btn"
          onClick={addTask}
          disabled={!newText.trim()}
          data-tooltip="Add task"
          data-tooltip-pos="top-end"
          aria-label="Add task"
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>

      {detectedUrl && (
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded bg-bg-elevated"
        >
          <LinkIcon size={12} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden />
          <span className="text-xs shrink-0 text-text-subtle">
            Link name:
          </span>
          <input
            ref={linkNameRef}
            className="input task-link-name-input"
            placeholder="e.g. Notes"
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (linkName.trim()) confirmLink();
              } else if (e.key === "Escape") {
                dismissLinkPrompt();
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "2px 6px", fontSize: 12 }}
            onClick={linkName.trim() ? confirmLink : dismissLinkPrompt}
          >
            {linkName.trim() ? "Add" : "Skip"}
          </button>
        </div>
      )}

      {renderPendingTasks()}

      {pending.length === 0 && exitingIds.size === 0 && completed.length > 0 && !q && (
        <div
          className="fade-rise flex items-center gap-2 py-2 text-sm text-text-muted"
        >
          <CheckCircle2 size={15} aria-hidden className="text-success" />
          {clearedLineForToday()}
        </div>
      )}

      {completed.length > 0 && (
        <>
          {(pending.length > 0 || !showCompleted) && (
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-medium pt-2 w-full cursor-pointer"
              style={{ color: "var(--text-subtle)", borderTop: pending.length > 0 ? "1px solid var(--border-muted)" : undefined }}
              onClick={() => setShowCompleted((v) => !v)}
              aria-expanded={showCompleted}
            >
              {showCompleted ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Done ({completed.length})
            </button>
          )}
          {/* Always mounted; grid-rows 0fr→1fr makes expand/collapse glide. */}
          <div
            style={{
              display: "grid",
              gridTemplateRows: showCompleted ? "1fr" : "0fr",
              transition: "grid-template-rows 200ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <div style={{ overflow: "hidden", minHeight: 0 }}>
              {completed.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  jiraStatus={task.jiraKey ? jiraStatuses[task.jiraKey] : undefined}
                  onToggle={() => toggleTask(task.id)}
                  onDelete={() => deleteTask(task.id)}
                  onEdit={(text) => updateTaskText(task.id, text)}
                  onAbandon={(reason) => abandonTask(task.id, reason)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {abandoned.length > 0 && (
        <>
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium pt-2 w-full cursor-pointer"
            style={{
              color: "var(--text-subtle)",
              borderTop: "1px solid var(--border-muted)",
              opacity: 0.7,
            }}
            onClick={() => setShowAbandoned((v) => !v)}
            aria-expanded={showAbandoned}
          >
            {showAbandoned ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Abandoned ({abandoned.length})
          </button>
          {showAbandoned && abandoned.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              jiraStatus={undefined}
              onToggle={() => reactivateTask(task.id)}
              onDelete={() => deleteTask(task.id)}
              onEdit={(text) => updateTaskText(task.id, text)}
              onAbandon={() => {}}
              onReactivate={() => reactivateTask(task.id)}
            />
          ))}
        </>
      )}

      {tasks.length === 0 && (
        <p className="text-xs text-center py-4 text-text-subtle">
          No tasks yet. Add one above.
        </p>
      )}

      {jiraModalTask && (
        <AddToJiraModal
          open
          task={jiraModalTask}
          onClose={() => setJiraModalTask(null)}
          onCreated={(newKey) => handleJiraCreated(jiraModalTask, newKey)}
        />
      )}

      {transitionPrompt && transitionPrompt.task.jiraKey && (
        <JiraTransitionModal
          open
          jiraKey={transitionPrompt.task.jiraKey}
          title={transitionPrompt.action === "complete" ? "Completed - update Jira?" : "Abandoned - update Jira?"}
          suggest={transitionPrompt.action === "complete" ? "Done" : "Won't Do"}
          onCancel={() => setTransitionPrompt(null)}
          onConfirm={resolveTransition}
        />
      )}

    </div>
  );
}

function SegmentedProgressBar({ open, done, abandoned }: { open: number; done: number; abandoned: number }) {
  const activeTotal = open + done;
  if (activeTotal === 0) return null;

  const pDone = (done / activeTotal) * 100;
  const pOpen = (open / activeTotal) * 100;

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 h-1.5 rounded-full overflow-hidden gap-px" aria-hidden>
        {done > 0 && (
          <div className="h-full shrink-0" style={{ width: `${pDone}%`, background: "var(--success)", borderRadius: 9 }} />
        )}
        {open > 0 && (
          <div className="h-full shrink-0" style={{ width: `${pOpen}%`, background: "var(--bg-elevated)", border: "1px solid var(--border-muted)", borderRadius: 9 }} />
        )}
        {abandoned > 0 && (
          <div className="h-full flex-1 min-w-0" style={{ background: "var(--text-subtle)", opacity: 0.4, borderRadius: 9 }} />
        )}
      </div>
      <span
        className="shrink-0 font-mono text-[11px] tabular-nums text-text-subtle"
        title={`${open} open, ${done} done, ${abandoned} abandoned`}
      >
        <span key={done} className="count-tick">{done}</span>/{activeTotal} done{abandoned > 0 ? ` · ${abandoned} abandoned` : ""}
      </span>
    </div>
  );
}
