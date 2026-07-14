"use client";

import { useCallback, useState } from "react";
import { Loader2, Search, FlaskConical, CheckCircle2, XCircle, Clock, ArrowLeft } from "lucide-react";
import { ModalShell } from "@/components/ModalShell";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import { formatTime } from "@/lib/utils";
import type { ResearchTask, TaskStatus } from "@/lib/briefing-tasks";

interface BriefingResearchProps {
  open: boolean;
  onClose: () => void;
}

interface TasksResponse {
  ok: boolean;
  tasks: ResearchTask[];
}

interface TaskDetail {
  ok: boolean;
  task: ResearchTask;
  markdown: string | null;
}

const STATUS_META: Record<TaskStatus, { label: string; className: string; icon: typeof Clock }> = {
  queued: { label: "Queued", className: "is-queued", icon: Clock },
  running: { label: "Researching", className: "is-running", icon: Loader2 },
  done: { label: "Ready", className: "is-done", icon: CheckCircle2 },
  failed: { label: "Failed", className: "is-failed", icon: XCircle },
};

function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`briefing-task-badge ${meta.className}`}>
      <Icon size={11} className={status === "running" ? "animate-spin" : ""} aria-hidden /> {meta.label}
    </span>
  );
}

export function BriefingResearch({ open, onClose }: BriefingResearchProps) {
  const { error: toastError } = useToast();
  const [topic, setTopic] = useState("");
  const [starting, setStarting] = useState(false);
  const [selected, setSelected] = useState<TaskDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const { data, mutate } = useLive<TasksResponse>(open ? "/api/briefing/tasks" : null, { refreshInterval: 5000 });
  const tasks = data?.tasks ?? [];

  const start = useCallback(async () => {
    const t = topic.trim();
    if (t.length < 3 || starting) return;
    setStarting(true);
    try {
      const res = await fetch("/api/briefing/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: t }),
      });
      if (!res.ok) throw new Error("Could not start research");
      setTopic("");
      await mutate();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not start research");
    } finally {
      setStarting(false);
    }
  }, [topic, starting, mutate, toastError]);

  const openDetail = useCallback(
    async (id: string) => {
      setLoadingDetail(true);
      try {
        const res = await fetch(`/api/briefing/tasks/${id}`, { cache: "no-store" });
        const json = (await res.json()) as TaskDetail;
        if (!res.ok || !json.ok) throw new Error("Could not load result");
        setSelected(json);
      } catch (err) {
        toastError(err instanceof Error ? err.message : "Could not load result");
      } finally {
        setLoadingDetail(false);
      }
    },
    [toastError],
  );

  if (!open) return null;

  return (
    <ModalShell
      open
      onClose={onClose}
      title={selected ? selected.task.topic : "Background research"}
      description={selected ? undefined : "Kick off one-off research and come back to it whenever. Results are saved."}
      maxWidth="max-w-2xl"
      align="top"
    >
      {selected ? (
        <div className="briefing-research-detail">
          <button type="button" className="btn btn-ghost text-xs" onClick={() => setSelected(null)}>
            <ArrowLeft size={12} aria-hidden /> Back to list
          </button>
          <div className="briefing-research-meta">
            <StatusBadge status={selected.task.status} />
            {selected.task.via && <span className="briefing-task-via">via {selected.task.via}</span>}
            <span className="briefing-task-time">Updated {formatTime(selected.task.updatedAt)}</span>
          </div>
          {selected.task.error && <p className="briefing-task-error">{selected.task.error}</p>}
          {selected.markdown ? (
            <pre className="briefing-research-md">{selected.markdown}</pre>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
              {selected.task.status === "done" ? "No saved text for this result." : "Still working on this one…"}
            </p>
          )}
        </div>
      ) : (
        <div className="briefing-research-shell">
          <form
            className="briefing-chat-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <input
              className="input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. best rated soft-play and rainy-day spots near Armagh"
              disabled={starting}
            />
            <button type="submit" className="btn btn-primary briefing-chat-send" disabled={starting || topic.trim().length < 3}>
              {starting ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Search size={13} aria-hidden />} Research
            </button>
          </form>

          {tasks.length === 0 ? (
            <div className="briefing-research-empty">
              <FlaskConical size={22} style={{ color: "var(--text-subtle)" }} aria-hidden />
              <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
                No research yet. Start one above, or just ask in the design chat.
              </p>
            </div>
          ) : (
            <ul className="briefing-task-list">
              {tasks.map((task) => {
                const clickable = task.status === "done" || task.status === "failed";
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      className="briefing-task-row"
                      onClick={() => clickable && void openDetail(task.id)}
                      disabled={!clickable || loadingDetail}
                    >
                      <span className="briefing-task-topic">{task.topic}</span>
                      <span className="briefing-task-side">
                        {task.summary && task.status === "done" && (
                          <span className="briefing-task-summary">{task.summary}</span>
                        )}
                        <StatusBadge status={task.status} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </ModalShell>
  );
}
