"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCopy, Check } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useVirtualRows } from "@/lib/hooks/use-virtual-rows";
import { formatRelative } from "@/lib/utils";
import type { TerminalTranscriptOptions } from "@/lib/terminal-launch";

/** Fixed row height the transcript windowing maths depends on. */
const TRANSCRIPT_ROW_H = 18;

interface TranscriptPayload {
  sessionId: string;
  lines: string[];
  modifiedAt: number;
  truncated: boolean;
}

/**
 * Read-only historical PTY transcript. Opened via `devhub:terminal-transcript`
 * (⌘K terminal search hits). Not a live dock tab — those sessions are usually gone.
 */
export function TerminalTranscriptModal() {
  const [target, setTarget] = useState<TerminalTranscriptOptions | null>(null);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ok"; data: TranscriptPayload }
  >({ status: "idle" });
  const [copied, setCopied] = useState<"line" | "all" | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  const lineCount = state.status === "ok" ? state.data.lines.length : 0;
  const { scrollRef, window: rows, scrollToRow } = useVirtualRows(lineCount, TRANSCRIPT_ROW_H);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<TerminalTranscriptOptions>).detail;
      if (!detail?.sessionId) return;
      setTarget(detail);
    };
    window.addEventListener("devhub:terminal-transcript", onOpen);
    return () => window.removeEventListener("devhub:terminal-transcript", onOpen);
  }, []);

  const onClose = useCallback(() => {
    setTarget(null);
    setState({ status: "idle" });
    setCopied(null);
  }, []);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    // Defer loading state like RunLogModal — avoids set-state-in-effect lint.
    const boot = window.setTimeout(() => {
      if (!cancelled) setState({ status: "loading" });
    }, 0);
    void fetch(`/api/terminal/transcript?session=${encodeURIComponent(target.sessionId)}`)
      .then(async (res) => {
        const body = (await res.json()) as TranscriptPayload | { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          const msg =
            typeof body === "object" && body && "error" in body && typeof body.error === "string"
              ? body.error
              : `HTTP ${res.status}`;
          setState({ status: "error", message: msg });
          return;
        }
        const data = body as TranscriptPayload;
        if (!Array.isArray(data.lines)) {
          setState({ status: "error", message: "Invalid transcript response" });
          return;
        }
        setState({ status: "ok", data });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Failed to load transcript",
        });
      });
    return () => {
      cancelled = true;
      window.clearTimeout(boot);
    };
  }, [target]);

  useEffect(() => {
    if (state.status !== "ok" || !target?.line) return;
    // Jump by index, not by ref: the matched line is usually outside the
    // rendered window, so scrolling the (unmounted) node would be a no-op.
    const id = window.requestAnimationFrame(() => scrollToRow(target.line! - 1));
    return () => window.cancelAnimationFrame(id);
  }, [state, target?.line, scrollToRow]);

  // Undefined when the hit's line falls outside the tail we fetched. "Copy line"
  // used to quietly fall back to the whole transcript in that case.
  const highlightedLine =
    state.status === "ok" && target?.line ? state.data.lines[target.line - 1] : undefined;

  const copy = useCallback(
    async (which: "line" | "all") => {
      if (state.status !== "ok") return;
      const text =
        which === "line" ? (highlightedLine ?? "") : state.data.lines.join("\n");
      if (!text) return;
      try {
        await copyTextToClipboard(text);
        setCopied(which);
        window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(null), 1500);
      } catch {
        /* clipboard blocked — leave button idle */
      }
    },
    [state, highlightedLine],
  );

  const open = Boolean(target);
  const shortId = target?.sessionId.slice(0, 8) ?? "";
  const when =
    state.status === "ok"
      ? formatRelative(state.data.modifiedAt)
      : target?.modifiedAt
        ? formatRelative(target.modifiedAt)
        : null;
  const description = [
    shortId ? `session ${shortId}` : null,
    when,
    target?.line ? `line ${target.line}` : null,
    state.status === "ok" && state.data.truncated ? "tail only" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Terminal transcript"
      description={description || undefined}
      maxWidth="max-w-3xl"
      align="top"
      footer={
        state.status === "ok" ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost text-xs"
              disabled={!highlightedLine}
              title={highlightedLine ? undefined : "No matched line in this transcript tail"}
              onClick={() => void copy("line")}
            >
              {copied === "line" ? <Check size={12} aria-hidden /> : <ClipboardCopy size={12} aria-hidden />}
              <span className="ml-1">{copied === "line" ? "Copied line" : "Copy line"}</span>
            </button>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => void copy("all")}>
              {copied === "all" ? <Check size={12} aria-hidden /> : <ClipboardCopy size={12} aria-hidden />}
              <span className="ml-1">{copied === "all" ? "Copied all" : "Copy all"}</span>
            </button>
            <span className="text-xs text-text-subtle ml-auto">
              {state.data.lines.length} line{state.data.lines.length === 1 ? "" : "s"}
              {state.data.truncated ? " (last 2MB)" : ""}
            </span>
          </div>
        ) : null
      }
    >
      {state.status === "loading" && (
        <div role="status" aria-label="Loading transcript">
          <SkeletonRows count={8} height={12} />
        </div>
      )}
      {state.status === "error" && <p className="text-xs m-0 text-danger">{state.message}</p>}
      {state.status === "ok" && (
        <div
          ref={scrollRef}
          className="font-mono text-xs rounded overflow-auto"
          style={{
            background: "var(--bg-muted)",
            border: "1px solid var(--border-muted)",
            maxHeight: "min(60vh, 560px)",
          }}
        >
          {state.data.lines.length === 0 ? (
            <p className="m-0 p-3 text-text-subtle">(empty transcript)</p>
          ) : (
            <>
              {/* Windowed — a 2MB tail is tens of thousands of lines. */}
              <div style={{ height: rows.padTop }} aria-hidden />
              {state.data.lines.slice(rows.start, rows.end).map((line, idx) => {
                const n = rows.start + idx + 1;
                const highlight = target?.line === n;
                return (
                  <div
                    key={n}
                    ref={highlight ? highlightRef : undefined}
                    className="flex gap-3 px-3"
                    style={{
                      height: TRANSCRIPT_ROW_H,
                      lineHeight: `${TRANSCRIPT_ROW_H}px`,
                      background: highlight ? "var(--bg-elevated)" : undefined,
                      boxShadow: highlight ? "inset 3px 0 0 var(--accent)" : undefined,
                      color: "var(--text)",
                    }}
                  >
                    <span
                      className="shrink-0 select-none text-right"
                      style={{ width: 40, color: "var(--text-subtle)" }}
                    >
                      {n}
                    </span>
                    {/* `pre` not `pre-wrap`: wrapping would break the fixed row
                        height the windowing maths depends on. */}
                    <span style={{ whiteSpace: "pre", overflow: "hidden" }}>{line || " "}</span>
                  </div>
                );
              })}
              <div style={{ height: rows.padBottom }} aria-hidden />
            </>
          )}
        </div>
      )}
    </ModalShell>
  );
}
