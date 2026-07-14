"use client";

import { useEffect, useState } from "react";
import { ScriptRunner } from "@/components/ScriptRunner";
import { JobsManager } from "@/components/JobsManager";
import { RunLogModal } from "@/components/RunLogModal";
import { Clock, CheckCircle, XCircle } from "lucide-react";

interface RunEntry {
  runId: string;
  script: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
}

function RunHistoryItem({ entry, onOpenLog }: { entry: RunEntry; onOpenLog: () => void }) {
  const started = new Date(entry.startedAt);
  const duration = entry.finishedAt
    ? Math.round((entry.finishedAt - entry.startedAt) / 1000)
    : null;
  const ok = entry.exitCode === 0;

  return (
    <button
      type="button"
      className="flex items-start justify-between gap-3 py-2 text-xs w-full text-left border-0 bg-transparent cursor-pointer rounded-sm"
      style={{ borderTop: "1px solid var(--border-muted)" }}
      onClick={onOpenLog}
      aria-label={`View log for ${entry.script}`}
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        {ok ? (
          <CheckCircle size={12} className="shrink-0 mt-0.5" style={{ color: "var(--success)" }} />
        ) : (
          <XCircle size={12} className="shrink-0 mt-0.5" style={{ color: "var(--danger)" }} />
        )}
        <span className="font-mono break-all leading-snug" style={{ color: "var(--text)" }}>{entry.script}</span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-3" style={{ color: "var(--text-subtle)" }}>
        {duration !== null && <span>{duration}s</span>}
        <span>{started.toLocaleDateString()} {started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </button>
  );
}

export default function ActionsPage() {
  const [history, setHistory] = useState<RunEntry[]>([]);
  const [refreshed, setRefreshed] = useState(0);
  const [logRunId, setLogRunId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/scripts/history")
      .then((r) => (r.ok ? r.json() : []))
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [refreshed]);

  return (
    <div className="page-wrapper">
      <h1 className="page-title mb-1">Actions</h1>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
        Run DevHub actions (TypeScript) with live output. One action at a time. For git blockers and hints, see{" "}
        <a href="/status" className="underline" style={{ color: "var(--accent)" }}>Status</a>.
      </p>
      <ScriptRunner onDone={() => setRefreshed((n) => n + 1)} />

      <JobsManager />

      {history.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              <Clock size={12} /> Run History
            </div>
            <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
              Last {history.length} runs
            </span>
          </div>
          <div className="card" style={{ padding: "4px 12px" }}>
            {history.map((entry) => (
              <RunHistoryItem
                key={entry.runId}
                entry={entry}
                onOpenLog={() => setLogRunId(entry.runId)}
              />
            ))}
          </div>
        </div>
      )}

      <RunLogModal open={logRunId !== null} runId={logRunId} onClose={() => setLogRunId(null)} />
    </div>
  );
}
