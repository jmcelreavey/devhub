"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Pause, Play, Trash2 } from "lucide-react";
import { formatLogTime } from "../../../../packages/shared/ui-lib/desktop/log-format";
import { isDesktop, openLogs } from "@/lib/desktop/bridge";
import { subscribeToTaskEvents } from "@/lib/events/task-subscription";
import { SkeletonRows } from "@/components/ui/SkeletonRows";

interface LogLine {
  raw: string;
  timestampMs: number | null;
  source: string;
  message: string;
}

interface LogsResponse {
  logDir: string;
  lines: LogLine[];
  count: number;
}

type SourceFilter = "all" | "shell" | "sidecar" | "renderer";

const SOURCE_OPTIONS: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "shell", label: "Shell" },
  { id: "sidecar", label: "Sidecar" },
  { id: "renderer", label: "Renderer" },
];

function sourceTone(source: string): string {
  if (source.startsWith("sidecar")) return "var(--accent)";
  if (source.startsWith("renderer")) return "var(--warning, #d29922)";
  if (source.includes("failure") || source.includes("error")) return "var(--danger)";
  return "var(--text-muted)";
}

export default function LogsPage() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [logDir, setLogDir] = useState<string | null>(null);
  const [source, setSource] = useState<SourceFilter>("all");
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scroller = useRef<HTMLPreElement>(null);
  const stickToBottom = useRef(true);
  const lastRaw = useRef<string>("");

  const pull = useCallback(async () => {
    try {
      const res = await fetch(`/api/status/logs?n=400&source=${source}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(`Could not read logs (${res.status}).`);
        return;
      }
      const body = (await res.json()) as LogsResponse;
      setLogDir(body.logDir);
      setError(null);
      const fingerprint = body.lines.map((l) => l.raw).join("\n");
      if (fingerprint !== lastRaw.current) {
        lastRaw.current = fingerprint;
        setLines(body.lines);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read logs.");
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void pull();
  }, [pull]);

  useEffect(() => {
    if (!live) return;
    let initial = true;
    return subscribeToTaskEvents({
      domains: ["logs"],
      connection: (connected) => { if (initial && connected) void pull(); initial = false; },
      refresh: () => { void pull(); },
    });
  }, [live, pull]);

  useEffect(() => {
    if (!stickToBottom.current || !scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [lines]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  return (
    <div className="page-wrapper flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-text">Logs</h1>
          <p className="mt-0.5 truncate font-mono text-[11px] text-text-subtle" title={logDir ?? undefined}>
            {logDir ?? (loading ? "Locating log directory…" : error ? "Log directory unavailable" : "No log directory found")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border">
            {SOURCE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="px-2.5 py-1 text-xs"
                style={{
                  background: source === opt.id ? "var(--surface-raised, var(--surface))" : "transparent",
                  color: source === opt.id ? "var(--text)" : "var(--text-muted)",
                }}
                aria-pressed={source === opt.id}
                onClick={() => setSource(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-ghost inline-flex items-center gap-1.5 text-xs"
            style={{ padding: "4px 10px", minHeight: 28 }}
            onClick={() => setLive((v) => !v)}
            title={live ? "Pause live updates" : "Resume live updates"}
          >
            {live ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />}
            {live ? "Live" : "Paused"}
          </button>
          <button
            type="button"
            className="btn btn-ghost inline-flex items-center gap-1.5 text-xs"
            style={{ padding: "4px 10px", minHeight: 28 }}
            onClick={() => {
              lastRaw.current = "";
              setLines([]);
              void pull();
            }}
            title="Clear the view and refetch"
          >
            <Trash2 size={12} aria-hidden />
            Clear
          </button>
          {isDesktop() && (
            <button
              type="button"
              className="btn btn-ghost inline-flex items-center gap-1.5 text-xs"
              style={{ padding: "4px 10px", minHeight: 28 }}
              onClick={() => void openLogs()}
            >
              <FolderOpen size={12} aria-hidden />
              Open folder
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-danger" role="alert">
          <span>{error}{lines.length > 0 ? " Showing the last loaded logs." : ""}</span>
          <button type="button" className="btn btn-ghost" onClick={() => void pull()}>Retry</button>
        </div>
      )}

      {loading && lines.length === 0 ? (
        <div role="status" aria-label="Loading logs" className="rounded-lg border border-border p-3" style={{ minHeight: "min(70vh, 40rem)" }}>
          <SkeletonRows count={5} variant="list" />
        </div>
      ) : (
      <pre
        ref={scroller}
        onScroll={onScroll}
        className="overflow-auto rounded-lg border border-border p-3 text-[12px] leading-5"
        style={{
          background: "var(--bg-elevated)",
          color: "var(--text-muted)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          minHeight: "min(70vh, 40rem)",
          maxHeight: "min(70vh, 40rem)",
        }}
        aria-live="polite"
        aria-relevant="additions"
      >
        {lines.length === 0 && !error ? (
          <span style={{ color: "var(--text-subtle)" }}>
            No log output yet. Launch or rebuild from the desktop app to produce some.
          </span>
        ) : (
          lines.map((line, index) => {
            const time = formatLogTime(line.timestampMs);
            return (
              <div key={`${line.raw}-${index}`} className="flex gap-3 whitespace-pre-wrap break-all">
                <span className="shrink-0 tabular-nums" style={{ color: "var(--text-subtle)", width: 64 }}>
                  {time || "—"}
                </span>
                <span className="shrink-0 truncate" style={{ color: sourceTone(line.source), width: 140 }}>
                  {line.source}
                </span>
                <span style={{ color: "var(--text)" }}>{line.message}</span>
              </div>
            );
          })
        )}
      </pre>
      )}
    </div>
  );
}
