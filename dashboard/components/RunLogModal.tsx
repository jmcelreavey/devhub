"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { SkeletonRows } from "@/components/SkeletonRows";

interface RunLogPayload {
  runId: string;
  script: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  lines: string[];
}

interface RunLogModalProps {
  open: boolean;
  onClose: () => void;
  runId: string | null;
}

export function RunLogModal({ open, onClose, runId }: RunLogModalProps) {
  const titleId = "run-log-modal-title";
  const previousFocus = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ok"; data: RunLogPayload }
  >({ status: "idle" });

  useEffect(() => {
    if (!open || !runId) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (!cancelled) setState({ status: "loading" });
    }, 0);
    void fetch(`/api/scripts/runs/${runId}`)
      .then(async (r) => {
        const body = (await r.json()) as RunLogPayload | { error?: string };
        if (cancelled) return;
        if (!r.ok) {
          const msg = typeof body === "object" && body && "error" in body && typeof body.error === "string"
            ? body.error
            : `HTTP ${r.status}`;
          setState({ status: "error", message: msg });
          return;
        }
        const data = body as RunLogPayload;
        if (!Array.isArray(data.lines)) {
          setState({ status: "error", message: "Invalid log response" });
          return;
        }
        setState({ status: "ok", data });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Failed to load log",
        });
      });
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [open, runId]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !runId) return null;

  const meta =
    state.status === "ok"
      ? `${state.data.script} · exit ${state.data.exitCode ?? "-"}, ${state.data.lines.length} line(s)`
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 300,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          padding: 16,
          background: "var(--bg-surface)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 shrink-0">
          <div>
            <h2 id={titleId} style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
              Run log
            </h2>
            {meta && (
              <p className="mt-1 mb-0 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                {meta}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "4px 6px", color: "var(--text-subtle)", flexShrink: 0 }}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        <div className="mt-3 flex-1 min-h-0 flex flex-col">
          {state.status === "loading" && (
            <div role="status" aria-label="Loading run log">
              <SkeletonRows count={5} height={10} />
            </div>
          )}
          {state.status === "error" && (
            <p className="text-xs m-0" style={{ color: "var(--danger)" }}>
              {state.message}
            </p>
          )}
          {state.status === "ok" && (
            <pre
              className="font-mono text-xs m-0 p-3 rounded overflow-auto flex-1"
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--border-muted)",
                color: "var(--text)",
                maxHeight: "min(60vh, 520px)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {state.data.lines.length ? state.data.lines.join("\n") : "(no output captured)"}
            </pre>
          )}
        </div>

        <p className="mt-2 mb-0 text-xs" style={{ color: "var(--text-subtle)" }}>
          Full output is also saved under{" "}
          <span className="font-mono">~/.local/state/devhub/run-logs/{runId}.json</span>.
        </p>
      </div>
    </div>
  );
}
