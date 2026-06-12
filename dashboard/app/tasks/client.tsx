"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { TaskItem } from "@/components/TaskList";
import { FetchError, SkeletonRows } from "@/components";
import { paletteCommandScore } from "@/lib/command-palette-score";
import { useToast } from "@/lib/use-toast";
import { useLive } from "@/lib/use-fetch";
import { BootScreen, useBootGate } from "@/components/TodayBootScreen";

const PAGE_SIZE = 50;
const FILTERS = ["all", "open", "done", "abandoned", "moved"] as const;

interface Task {
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
}

interface TaskDay {
  date: string;
  total: number;
  completed: number;
  abandoned: number;
  moved: number;
  modified: number;
  tasks: Task[];
}

interface TaskRecord {
  task: Task;
  date: string;
  dayLabel: string;
  status: "open" | "done" | "abandoned" | "moved";
  score: number;
}

type StatusFilter = (typeof FILTERS)[number];

function formatDateKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function taskStatus(task: Task): TaskRecord["status"] {
  if (task.movedAt) return "moved";
  if (task.abandonedAt) return "abandoned";
  if (task.done) return "done";
  return "open";
}

function formatMovedToDate(dateStr: string): string {
  return formatDateKey(dateStr);
}

function taskSearchParts(record: Omit<TaskRecord, "score">): string[] {
  return [
    record.task.text,
    record.task.jiraKey ?? "",
    record.status,
    record.date,
    record.dayLabel,
    record.task.due ?? "",
    record.task.abandonReason ?? "",
  ];
}

function compareTaskRecords(a: TaskRecord, b: TaskRecord): number {
  if (a.score !== b.score) return b.score - a.score;
  const aTime = Date.parse(a.task.createdAt || a.date);
  const bTime = Date.parse(b.task.createdAt || b.date);
  return bTime - aTime;
}

function statusBadgeClass(status: TaskRecord["status"]): string {
  if (status === "done") return "badge badge-success";
  if (status === "abandoned" || status === "moved") return "badge badge-muted";
  return "badge badge-accent";
}

function summarizeDay(day: TaskDay): TaskDay {
  return {
    ...day,
    total: day.tasks.length,
    completed: day.tasks.filter((t) => t.done).length,
    abandoned: day.tasks.filter((t) => !!t.abandonedAt).length,
    moved: day.tasks.filter((t) => !!t.movedAt).length,
  };
}

function updateTaskInDays(
  days: TaskDay[] | undefined,
  date: string,
  id: string,
  update: Task | null | ((task: Task) => Task),
): TaskDay[] {
  return (days ?? []).map((day) => {
    if (day.date !== date) return day;
    const tasks = typeof update === "function"
      ? day.tasks.map((task) => (task.id === id ? update(task) : task))
      : update
        ? day.tasks.map((task) => (task.id === id ? update : task))
        : day.tasks.filter((task) => task.id !== id);
    return summarizeDay({ ...day, tasks });
  });
}

function TaskRow({
  record,
  onToggle,
  onEdit,
  onAbandon,
  onReactivate,
  onDelete,
}: {
  record: TaskRecord;
  onToggle: () => void;
  onEdit: (text: string) => void;
  onAbandon: (reason?: string) => void;
  onReactivate: () => void;
  onDelete: () => void;
}) {
  const { task, status } = record;

  return (
    <div className="card group" style={{ padding: "8px 10px" }}>
      <div className="mb-1 flex flex-wrap items-center gap-2 px-2">
        <span className={statusBadgeClass(status)}>{status}</span>
        <span className="text-xs" style={{ color: "var(--text-subtle)" }}>{record.dayLabel}</span>
        {task.due ? <span className="text-xs" style={{ color: "var(--text-muted)" }}>Due {task.due}</span> : null}
      </div>
        {status === "moved" && task.movedToDate ? (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Continued on {formatMovedToDate(task.movedToDate)}
          </span>
        ) : null}
      <TaskItem
        task={task}
        readOnly={status === "moved"}
        onToggle={status === "abandoned" ? onReactivate : onToggle}
        onDelete={onDelete}
        onEdit={onEdit}
        onAbandon={onAbandon}
        onReactivate={onReactivate}
      />
    </div>
  );
}

export default function TasksPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const { data, error, isLoading, mutate } = useLive<TaskDay[]>("/api/tasks/history?includeTasks=1");
  const boot = useBootGate(data !== undefined || !!error);
  const toast = useToast();

  const allRecords = useMemo(() => {
    return (data ?? [])
      .flatMap((day) => {
        const dayLabel = formatDateKey(day.date);
        return day.tasks.map((task) => {
          const base = { task, date: day.date, dayLabel, status: taskStatus(task) };
          return { ...base, score: 1 };
        });
      })
      .sort(compareTaskRecords);
  }, [data]);

  const counts = useMemo(() => ({
    all: allRecords.length,
    open: allRecords.filter((r) => r.status === "open").length,
    done: allRecords.filter((r) => r.status === "done").length,
    abandoned: allRecords.filter((r) => r.status === "abandoned").length,
    moved: allRecords.filter((r) => r.status === "moved").length,
  }), [allRecords]);

  const records = useMemo(() => {
    const q = query.trim();
    return allRecords
      .filter((record) => filter === "all" || record.status === filter)
      .map((record) => ({
        ...record,
        score: q ? paletteCommandScore(q, taskSearchParts(record)) : 1,
      }))
      .filter((record) => !q || record.score > 0)
      .sort(compareTaskRecords);
  }, [allRecords, filter, query]);

  const patchTask = async (
    record: TaskRecord,
    body: Record<string, unknown>,
    optimistic: (task: Task) => Task,
    errorMessage: string,
  ) => {
    await mutate((cur) => updateTaskInDays(cur, record.date, record.task.id, optimistic), { revalidate: false });
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.task.id, date: record.date, ...body }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = (await res.json()) as Task;
      await mutate((cur) => updateTaskInDays(cur, record.date, record.task.id, updated), { revalidate: false });
    } catch (err) {
      console.error(errorMessage, err);
      toast.error(errorMessage);
      await mutate();
    }
  };

  const deleteTask = async (record: TaskRecord) => {
    await mutate((cur) => updateTaskInDays(cur, record.date, record.task.id, null), { revalidate: false });
    try {
      const res = await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.task.id, date: record.date }),
      });
      if (!res.ok && res.status !== 404) throw new Error(await res.text());
    } catch (err) {
      console.error("delete task:", err);
      toast.error("Couldn't delete task.");
      await mutate();
      return;
    }

    toast.info("Task deleted.", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            const res = await fetch("/api/tasks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: record.task.text, due: record.task.due, date: record.date }),
            });
            if (!res.ok) throw new Error(await res.text());
            await mutate();
          } catch (err) {
            console.error("restore task:", err);
            toast.error("Couldn't restore task.");
          }
        },
      },
    });
  };

  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visibleRecords = records.slice(pageStart, pageStart + PAGE_SIZE);
  const rangeStart = records.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + PAGE_SIZE, records.length);

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      <div className="page-header">
        <div>
          <div className="page-title">Tasks</div>
          <div className="text-xs" style={{ color: "var(--text-subtle)" }}>
            {counts.all} total · {counts.open} open · {counts.done} done · {counts.abandoned} abandoned · {counts.moved} moved
          </div>
        </div>
      </div>

      {error && <FetchError message="Couldn't load task history." />}

      <div className="card card-body mb-4 space-y-3">
        <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 8,
        }}
      >
        <Search size={15} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden />
        <label htmlFor="tasks-search" className="sr-only">Search tasks</label>
        <input
          id="tasks-search"
          type="text"
          placeholder="Search tasks, Jira keys, dates, status…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          style={{ color: "var(--text)" }}
        />
        {query ? (
          <button
            type="button"
            className="rounded p-1 transition-colors hover:bg-[var(--bg-muted)]"
            onClick={() => {
              setQuery("");
              setPage(1);
            }}
            style={{ color: "var(--text-subtle)", flexShrink: 0 }}
            aria-label="Clear task search"
          >
            <X size={14} aria-hidden />
          </button>
        ) : null}
        </div>

        <div className="flex flex-wrap gap-1">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              style={{
                background: filter === value ? "var(--accent-dim)" : "var(--bg-elevated)",
                color: filter === value ? "var(--accent)" : "var(--text-muted)",
                border: filter === value ? "1px solid color-mix(in oklab, var(--accent) 30%, transparent)" : "1px solid var(--border-muted)",
              }}
              aria-pressed={filter === value}
            >
              {value === "all" ? "All" : value[0].toUpperCase() + value.slice(1)}
              <span className="ml-1 badge badge-muted" style={{ fontSize: 12 }}>{counts[value]}</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading && !data && <SkeletonRows count={5} height={40} variant="list" />}

      {!isLoading && !error && records.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {query ? "No matching tasks found." : "No tasks yet."}
        </p>
      )}

      {records.length > 0 ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
              Showing {rangeStart}-{rangeEnd} of {records.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "4px 10px" }}
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={12} aria-hidden /> Prev
              </button>
              <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
                Page {safePage} of {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "4px 10px" }}
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next <ChevronRight size={12} aria-hidden />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {visibleRecords.map((record) => (
              <TaskRow
                key={`${record.date}-${record.task.id}`}
                record={record}
                onToggle={() => patchTask(
                  record,
                  { done: !record.task.done },
                  (task) => ({
                    ...task,
                    done: !task.done,
                    completedAt: !task.done ? new Date().toISOString() : undefined,
                    abandonedAt: !task.done ? undefined : task.abandonedAt,
                    abandonReason: !task.done ? undefined : task.abandonReason,
                  }),
                  "Couldn't update task.",
                )}
                onEdit={(text) => patchTask(
                  record,
                  { text },
                  (task) => ({ ...task, text }),
                  "Couldn't update task.",
                )}
                onAbandon={(reason) => patchTask(
                  record,
                  { status: "abandoned", abandonReason: reason },
                  (task) => ({
                    ...task,
                    done: false,
                    completedAt: undefined,
                    abandonedAt: new Date().toISOString(),
                    abandonReason: reason,
                  }),
                  "Couldn't abandon task.",
                )}
                onReactivate={() => patchTask(
                  record,
                  { status: "active" },
                  (task) => ({
                    ...task,
                    done: false,
                    completedAt: undefined,
                    abandonedAt: undefined,
                    abandonReason: undefined,
                  }),
                  "Couldn't reactivate task.",
                )}
                onDelete={() => deleteTask(record)}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
