"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Search, RefreshCw, CheckCircle2, Ban } from "lucide-react";
import { SidePanel } from "./SidePanel";
import { HoverTip } from "@/components/HoverTip";
import {
  TaskList,
  renderTaskTextContent,
  matchesTaskSearch,
} from "./TaskList";
import type { Task } from "./TaskList";
import { todayISO } from "@/lib/utils";

interface TasksOverlayProps {
  open: boolean;
  onClose: () => void;
}

interface HistoricalDay {
  date: string;
  tasks: Task[];
}

type TabKind = "active" | "completed";

const TAB_LABELS: Record<TabKind, string> = {
  active: "Active",
  completed: "Completed",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}

export function TasksOverlay({ open, onClose }: TasksOverlayProps) {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<TabKind>("active");
  const [historicalDays, setHistoricalDays] = useState<HistoricalDay[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleClose = useCallback(() => {
    setQuery("");
    setActiveTab("active");
    setHistoricalDays([]);
    onClose();
  }, [onClose]);

  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const r = await fetch("/api/tasks/history?includeTasks=1");
      if (!r.ok) return;
      const days: HistoricalDay[] = await r.json();
      const today = todayISO();
      const result = days
        .filter((d) => d.date !== today)
        .map((d) => ({
          date: d.date,
          tasks: d.tasks.filter((t) => t.done || t.abandonedAt || t.movedAt),
        }))
        .filter((d) => d.tasks.length > 0);
      setHistoricalDays(result);
    } catch {
      // ignore
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (open && activeTab === "completed") {
      const timeout = window.setTimeout(() => void loadHistory(), 0);
      return () => window.clearTimeout(timeout);
    }
  }, [open, activeTab, loadHistory]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (activeTab === "active") {
        setRefreshKey((k) => k + 1);
      } else {
        await loadHistory();
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [activeTab, loadHistory]);

  const q = query.toLowerCase();
  const filteredDays = q
    ? historicalDays
        .map((d) => ({
          ...d,
          tasks: d.tasks.filter((t) => matchesTaskSearch(t, q)),
        }))
        .filter((d) => d.tasks.length > 0)
    : historicalDays;

  return (
      <SidePanel
        open={open}
        onClose={handleClose}
        storageKey="tasks-panel-width"
        ariaLabel="Tasks"
    >
      <div
        className="flex items-center gap-2 px-4 py-3 border-b shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <Search
          size={14}
          style={{ color: "var(--text-muted)", flexShrink: 0 }}
          aria-hidden
        />
        <label htmlFor="tasks-search-input" className="sr-only">
          Search tasks
        </label>
        <input
          id="tasks-search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks…"
          autoFocus
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: "var(--text)" }}
        />
        <HoverTip label={isRefreshing ? "Refreshing…" : "Refresh tasks"}>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            aria-label="Refresh tasks"
            className="shrink-0 rounded p-0.5 disabled:opacity-50 hover:bg-[var(--bg-elevated)]"
          >
            <RefreshCw
              size={14}
              className={isRefreshing ? "animate-spin" : ""}
              style={{ color: "var(--text-muted)" }}
              aria-hidden
            />
          </button>
        </HoverTip>
        <button type="button" onClick={handleClose} aria-label="Close tasks panel">
          <X size={16} style={{ color: "var(--text-muted)" }} aria-hidden />
        </button>
      </div>

      <div
        className="flex shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {(["active", "completed"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="flex-1 text-center text-xs font-medium py-2 transition-colors"
            style={{
              color:
                activeTab === tab ? "var(--text)" : "var(--text-subtle)",
              borderBottom:
                activeTab === tab
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
              background: "none",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              cursor: "pointer",
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {activeTab === "active" ? (
          <div className="p-3">
            <TaskList
              key={refreshKey}
              inputId="hub-tasks-side-input"
              searchQuery={query}
            />
          </div>
        ) : isLoadingHistory ? (
          <div className="p-4 text-center">
            <div
              className="skeleton inline-block"
              style={{ height: "20px", width: "60%" }}
            />
          </div>
        ) : filteredDays.length === 0 ? (
          <p
            className="text-xs text-center py-4"
            style={{ color: "var(--text-subtle)" }}
          >
            {q
              ? `No results for "${query}"`
              : "No completed tasks in recent days."}
          </p>
        ) : (
          <div className="p-2">
            {filteredDays.map((day) => (
              <div key={day.date} className="mb-3">
                <div
                  className="text-xs font-semibold px-3 py-1 mb-1"
                  style={{ color: "var(--text-subtle)" }}
                >
                  {formatDate(day.date)}
                </div>
                {day.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded text-xs"
                  >
                    {task.abandonedAt ? (
                      <Ban
                        size={14}
                        style={{
                          color: "var(--text-subtle)",
                          opacity: 0.5,
                          flexShrink: 0,
                        }}
                        aria-hidden
                      />
                    ) : (
                      <CheckCircle2
                        size={14}
                        style={{
                          color: "var(--success)",
                          opacity: 0.7,
                          flexShrink: 0,
                        }}
                        aria-hidden
                      />
                    )}
                    {task.jiraKey && (
                      <span
                        className="shrink-0 font-mono px-1.5 py-0.5 rounded"
                        style={{
                          background: "var(--accent-dim)",
                          color: "var(--accent)",
                          fontSize: 12,
                        }}
                      >
                        {task.jiraKey}
                      </span>
                    )}
                    <span
                      className="flex-1 min-w-0 truncate"
                      style={{
                        color: "var(--text)",
                        textDecoration: task.done
                          ? "line-through"
                          : "none",
                        opacity: task.abandonedAt ? 0.5 : 0.7,
                      }}
                    >
                      {renderTaskTextContent(task.text)}
                    </span>
                    {task.abandonedAt && task.abandonReason && (
                      <span
                        className="shrink-0"
                        style={{
                          color: "var(--text-subtle)",
                          opacity: 0.6,
                        }}
                      >
                        — {task.abandonReason}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </SidePanel>
  );
}
