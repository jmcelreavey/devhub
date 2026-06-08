"use client";

import { useState, useEffect, useCallback, useRef, type HTMLAttributes, type ReactNode } from "react";
import { Plus, X, ExternalLink, Circle, CheckCircle2, Pencil, Ban, RotateCcw, Link as LinkIcon, ChevronRight, ChevronDown, ArrowRight, Play, Pause, GripVertical } from "lucide-react";
import { useToast } from "@/lib/use-toast";
import { useLive } from "@/lib/use-fetch";
import { statusTone } from "@/components/JiraWidget";
import { SeverityPill } from "@/components/ui/Severity";
import { SortableList } from "@/components/ui/SortableList";
import { useGridSize } from "@/lib/use-grid-size";
import { todayISO, formatDuration, jiraBrowseUrl } from "@/lib/utils";

export interface Task {
  id: string;
  text: string;
  done: boolean;
  jiraKey?: string;
  due?: string;
  createdAt: string;
  completedAt?: string;
  abandonedAt?: string;
  abandonReason?: string;
  movedAt?: string;
  movedToDate?: string;
  timeSpentMs?: number;
  timerStartedAt?: string;
}

function isTaskOpen(task: Task): boolean {
  return !task.done && !task.abandonedAt && !task.movedAt;
}

interface JiraStatus {
  name: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLinkedJiraKeyFromText(text: string, jiraKey: string): string {
  const re = new RegExp(`\\b${escapeRegExp(jiraKey)}\\b`, "gi");
  return text
    .replace(re, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—,:]\s*/, "")
    .trim();
}

const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

interface TextPart {
  type: "text" | "link";
  text: string;
  url?: string;
}

function parseMarkdownLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MD_LINK_RE)) {
    if (match.index! > lastIndex) {
      parts.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "link", text: match[1], url: match[2] });
    lastIndex = match.index! + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", text: text.slice(lastIndex) });
  }
  return parts;
}

export function renderTaskTextContent(text: string): ReactNode {
  const parts = parseMarkdownLinks(text);
  if (parts.length === 0 || (parts.length === 1 && parts[0].type === "text")) {
    return text;
  }
  return parts.map((part, i) => {
    if (part.type === "link") {
      return (
        <a
          key={i}
          href={part.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            color: "var(--accent)",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
          }}
        >
          {part.text}
        </a>
      );
    }
    return <span key={i}>{part.text}</span>;
  });
}

const BARE_URL_RE = /(?<!\(\s?)https?:\/\/[^\s)\]]+/;

function detectBareUrl(text: string): string | null {
  if (MD_LINK_RE.test(text)) {
    MD_LINK_RE.lastIndex = 0;
    return null;
  }
  MD_LINK_RE.lastIndex = 0;
  const match = text.match(BARE_URL_RE);
  return match ? match[0] : null;
}

const EMPTY_TASKS: Task[] = [];

export function matchesTaskSearch(task: Task, query: string): boolean {
  if (!query) return true;
  return (
    task.text.toLowerCase().includes(query) ||
    (!!task.jiraKey && task.jiraKey.toLowerCase().includes(query))
  );
}

export interface TaskListProps {
  inputId?: string;
  searchQuery?: string;
}

export function TaskList({ inputId = "task-add-text", searchQuery }: TaskListProps) {
  const { data, error, isLoading, mutate } = useLive<{ tasks?: Task[] }>("/api/tasks");
  const gridSize = useGridSize("main");
  const tasks = data?.tasks ?? EMPTY_TASKS;
  const [newText, setNewText] = useState("");
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const [linkName, setLinkName] = useState("");
  const [jiraStatuses, setJiraStatuses] = useState<Record<string, JiraStatus>>({});
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

  const pending = tasks.filter((t) => isTaskOpen(t) && matchesTaskSearch(t, q));
  const completed = tasks.filter((t) => t.done && matchesTaskSearch(t, q));
  const abandoned = tasks.filter((t) => !!t.abandonedAt && matchesTaskSearch(t, q));

  const renderPendingTasks = () => (
    <SortableList
      items={pending}
      getId={(task) => task.id}
      disabled={!!q}
      onReorder={reorderTasks}
      renderItem={(task, { dragHandleProps, isDragging, isDropTarget }) => (
        <TaskItem
          task={task}
          jiraStatus={task.jiraKey ? jiraStatuses[task.jiraKey] : undefined}
          dragHandleProps={q ? undefined : dragHandleProps}
          isDragging={isDragging}
          isDropTarget={isDropTarget}
          onToggle={() => toggleTask(task.id)}
          onDelete={() => deleteTask(task.id)}
          onEdit={(text) => updateTaskText(task.id, text)}
          onAbandon={(reason) => abandonTask(task.id, reason)}
          onTimer={() => toggleTimer(task.id)}
        />
      )}
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
          <div className="truncate text-[13px]" style={{ color: "var(--text)" }}>{inFlight.text}</div>
        )}
        <div className="flex gap-2 text-[11px] font-mono tabular-nums" style={{ color: "var(--text-subtle)" }}>
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
          <div className="text-[11px] font-mono" style={{ color: "var(--text-subtle)" }}>
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
          aria-label="Add task"
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>

      {detectedUrl && (
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded"
          style={{ background: "var(--bg-elevated)" }}
        >
          <LinkIcon size={12} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden />
          <span className="text-xs shrink-0" style={{ color: "var(--text-subtle)" }}>
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
          {showCompleted && completed.map((task) => (
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
        <p className="text-xs text-center py-4" style={{ color: "var(--text-subtle)" }}>
          No tasks yet. Add one above.
        </p>
      )}
    </div>
  );
}

export function TaskItem({
  task,
  jiraStatus,
  readOnly = false,
  onToggle,
  onDelete,
  onEdit,
  onAbandon,
  onReactivate,
  onTimer,
  dragHandleProps,
  isDragging = false,
  isDropTarget = false,
}: {
  task: Task;
  jiraStatus?: JiraStatus;
  readOnly?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: (text: string) => void;
  onAbandon: (reason?: string) => void;
  onReactivate?: () => void;
  onTimer?: () => void;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement> & { draggable: boolean };
  isDragging?: boolean;
  isDropTarget?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(task.text);
  const [showAbandon, setShowAbandon] = useState(false);
  const [abandonReason, setAbandonReason] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const isAbandoned = !!task.abandonedAt;
  const isMoved = !!task.movedAt;
  const isInactive = isAbandoned || isMoved || readOnly;
  const isInFlight = isTaskOpen(task) && !!jiraStatus && statusTone(jiraStatus.name) === "info";

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const saveEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== task.text) {
      onEdit(trimmed);
    } else {
      setEditText(task.text);
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditText(task.text);
    setEditing(false);
  };

  const confirmAbandon = () => {
    onAbandon(abandonReason.trim() || undefined);
    setShowAbandon(false);
    setAbandonReason("");
  };

  const displayText = task.jiraKey
    ? stripLinkedJiraKeyFromText(task.text, task.jiraKey)
    : task.text;

  const textStyle: React.CSSProperties = {
    color: task.done || isInactive ? "var(--text-subtle)" : "var(--text)",
    textDecoration: task.done ? "line-through" : "none",
    opacity: task.done ? 0.6 : isInactive ? 0.45 : 1,
  };

  const dueDateLabel = task.due ? new Date(task.due).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;

  return (
    <div style={isInFlight ? { borderLeft: "3px solid var(--accent)", paddingLeft: 4, borderRadius: 2 } : undefined}>
      <div
        className="flex items-start gap-2.5 group rounded px-2 py-1.5 transition-colors"
        style={{
          opacity: isDragging ? 0.45 : undefined,
          background: isDropTarget ? "var(--bg-elevated)" : undefined,
          outline: isDropTarget ? "1px solid var(--accent)" : undefined,
        }}
      >
        {dragHandleProps && !isInactive && !editing && !showAbandon && (
          <button
            type="button"
            {...dragHandleProps}
            className="shrink-0 rounded p-0.5 opacity-30 hover:opacity-100 group-hover:opacity-100 focus:opacity-100"
            style={{ color: "var(--text-subtle)", cursor: "grab" }}
            aria-label={`Drag to reorder ${task.text}`}
            title="Drag to reorder. Arrow keys also work."
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} aria-hidden />
          </button>
        )}
        {isMoved ? (
          <span
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "2px 4px",
            }}
            aria-hidden
          >
            <ArrowRight size={16} style={{ color: "var(--text-subtle)", opacity: 0.5 }} />
          </span>
        ) : isAbandoned ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReactivate?.();
            }}
            aria-label="Reactivate task"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ban size={16} style={{ color: "var(--text-subtle)", opacity: 0.5 }} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={task.done ? "Mark task incomplete" : "Mark task complete"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {task.done ? (
              <CheckCircle2
                key="done"
                size={16}
                style={{ color: "var(--success)" }}
                className="task-check-pulse"
                aria-hidden
              />
            ) : (
              <Circle size={16} style={{ color: "var(--text-subtle)" }} aria-hidden />
            )}
          </button>
        )}

        <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {task.jiraKey && !isAbandoned && (
            <span
              className="shrink-0 font-mono text-xs px-1.5 py-0.5 rounded"
              style={{
                background: "var(--accent-dim)",
                color: "var(--accent)",
                textDecoration: task.done ? "line-through" : "none",
                opacity: task.done ? 0.5 : 1,
              }}
            >
              {task.jiraKey}
            </span>
          )}

          {editing ? (
            <input
              ref={editRef}
              className="input"
              style={{ fontSize: "13px", flex: 1, minWidth: 0 }}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  cancelEdit();
                }
              }}
              onBlur={saveEdit}
            />
          ) : (
            <span className="text-sm min-w-0 flex-1 basis-[min(100%,12rem)] break-words leading-snug" style={textStyle}>
              {task.jiraKey && !isAbandoned
                ? renderTaskTextContent(displayText)
                : renderTaskTextContent(task.text)}
            </span>
          )}

          {jiraStatus && !task.done && !isAbandoned && (
            <SeverityPill tone={statusTone(jiraStatus.name)}>{jiraStatus.name}</SeverityPill>
          )}

          {isAbandoned && task.abandonReason && (
            <span
              className="text-xs min-w-0 basis-full break-words leading-snug"
              style={{ color: "var(--text-subtle)", opacity: 0.6 }}
            >
              — {task.abandonReason}
            </span>
          )}
          {dueDateLabel && !task.done && !isAbandoned && (
            <span className="text-xs shrink-0 font-mono" style={{ color: "var(--text-subtle)" }}>
              due {dueDateLabel}
            </span>
          )}
          {onTimer && !isInactive && <TimerControl task={task} onTimer={onTimer} />}
          {!onTimer && !task.timerStartedAt && (task.timeSpentMs ?? 0) > 0 && (
            <span className="text-xs shrink-0 font-mono" style={{ color: "var(--text-subtle)" }}>
              {formatDuration(task.timeSpentMs ?? 0)}
            </span>
          )}
        </div>

        {!editing && !showAbandon && (
          <div className="flex items-start gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {!isAbandoned && task.jiraKey && (
              <a
                href={jiraBrowseUrl(task.jiraKey)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Open ${task.jiraKey} in Jira`}
                style={{
                  color: "var(--text-subtle)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <ExternalLink size={12} aria-hidden />
              </a>
            )}
            {!isInactive && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(true);
                  setEditText(task.text);
                }}
                aria-label="Edit task"
                style={{
                  color: "var(--text-subtle)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Pencil size={12} aria-hidden />
              </button>
            )}
            {!isInactive && !task.done && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAbandon(true);
                }}
                aria-label="Abandon task"
                style={{
                  color: "var(--text-subtle)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Ban size={12} aria-hidden />
              </button>
            )}
            {isAbandoned && onReactivate && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onReactivate();
                }}
                aria-label="Reactivate task"
                style={{
                  color: "var(--text-subtle)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <RotateCcw size={12} aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Delete task"
              style={{
                color: "var(--text-subtle)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        )}
      </div>

      {showAbandon && (
        <div
          className="flex items-center gap-2 ml-9 mr-2 mb-1"
          style={{ animation: "fadeSlideIn 0.15s ease-out" }}
        >
          <input
            className="input"
            style={{ fontSize: "12px", flex: 1, minWidth: 0 }}
            placeholder="Reason (optional)…"
            value={abandonReason}
            onChange={(e) => setAbandonReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmAbandon();
              } else if (e.key === "Escape") {
                setShowAbandon(false);
                setAbandonReason("");
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "3px 8px", fontSize: 12 }}
            onClick={confirmAbandon}
          >
            Confirm
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "3px 8px", fontSize: 12 }}
            onClick={() => {
              setShowAbandon(false);
              setAbandonReason("");
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** Play/pause control with live-ticking elapsed time for an active task. */
function TimerControl({ task, onTimer }: { task: Task; onTimer: () => void }) {
  const running = !!task.timerStartedAt;
  const base = task.timeSpentMs ?? 0;
  const startedMs = running ? Date.parse(task.timerStartedAt!) : 0;
  const [elapsedMs, setElapsedMs] = useState(base);

  useEffect(() => {
    const tick = () => setElapsedMs(base + (running ? Math.max(0, Date.now() - startedMs) : 0));
    tick();
    if (!running) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [base, running, startedMs]);

  const hasTime = elapsedMs > 0;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onTimer();
      }}
      aria-label={running ? "Stop timer" : "Start timer"}
      title={running ? "Stop timer" : "Start timer"}
      className={running ? undefined : "opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        flexShrink: 0,
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "0 2px",
        fontFamily: "var(--font-mono, monospace)",
        fontSize: 12,
        color: running ? "var(--accent)" : "var(--text-subtle)",
      }}
    >
      {running ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />}
      {hasTime && <span className="tabular-nums">{formatDuration(elapsedMs)}</span>}
    </button>
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
          <div className="h-full shrink-0 transition-all duration-300" style={{ width: `${pDone}%`, background: "var(--success)", borderRadius: 9 }} />
        )}
        {open > 0 && (
          <div className="h-full shrink-0 transition-all duration-300" style={{ width: `${pOpen}%`, background: "var(--bg-elevated)", border: "1px solid var(--border-muted)", borderRadius: 9 }} />
        )}
        {abandoned > 0 && (
          <div className="h-full flex-1 min-w-0 transition-all duration-300" style={{ background: "var(--text-subtle)", opacity: 0.4, borderRadius: 9 }} />
        )}
      </div>
      <span
        className="shrink-0 font-mono text-[11px] tabular-nums"
        style={{ color: "var(--text-subtle)" }}
        title={`${open} open · ${done} done · ${abandoned} abandoned`}
      >
        {done}/{activeTotal} done{abandoned > 0 ? ` · ${abandoned} abandoned` : ""}
      </span>
    </div>
  );
}
