"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Bot, Minus, Plus } from "lucide-react";
import type { DiffLine } from "@/lib/repo-git-parsers";

export interface DiffHunkAction {
  hunkIndex: number;
}

interface GitDiffViewProps {
  lines: DiffLine[];
  emptyMessage?: string;
  /** When set, show Stage/Unstage on hunk headers. */
  hunkMode?: "stage" | "unstage";
  hunkBusy?: boolean;
  onHunkAction?: (action: DiffHunkAction) => void;
  /** Selection → AI */
  onSendSelectionToAi?: (snippet: string, lineHint: string) => void;
}

interface HunkSpan {
  hunkIndex: number;
  headerLineIndex: number;
}

function buildHunkSpans(lines: DiffLine[]): HunkSpan[] {
  const spans: HunkSpan[] = [];
  let hunkIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.type === "hunk") {
      spans.push({ hunkIndex, headerLineIndex: i });
      hunkIndex++;
    }
  }
  return spans;
}

export function GitDiffView({
  lines,
  emptyMessage = "No diff for this selection.",
  hunkMode,
  hunkBusy,
  onHunkAction,
  onSendSelectionToAi,
}: GitDiffViewProps) {
  const rootRef = useRef<HTMLPreElement>(null);
  const [aiPopup, setAiPopup] = useState<{ x: number; y: number; snippet: string; hint: string } | null>(
    null,
  );
  const [prevLines, setPrevLines] = useState(lines);

  // Dismiss a stale AI selection when the diff content changes.
  if (lines !== prevLines) {
    setPrevLines(lines);
    setAiPopup(null);
  }

  const hunkSpans = useMemo(() => buildHunkSpans(lines), [lines]);

  const onMouseUp = useCallback(() => {
    if (!onSendSelectionToAi || !rootRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      return;
    }
    if (!rootRef.current.contains(sel.anchorNode)) return;
    const snippet = sel.toString();
    if (!snippet.trim()) return;
    const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect();
    const host = rootRef.current.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 - host.left : 24;
    const y = rect ? rect.bottom - host.top + 8 : 24;
    const hint =
      snippet.length > 400
        ? `selection (~${snippet.length} chars — see file)`
        : `selected ${snippet.split("\n").length} line(s)`;
    setAiPopup({ x, y, snippet: snippet.slice(0, 2000), hint });
  }, [onSendSelectionToAi]);

  if (lines.length === 0 || lines.every((l) => !l.text.trim())) {
    return <div className="repo-git-diff-empty">{emptyMessage}</div>;
  }

  const hunkByHeader = new Map(hunkSpans.map((s) => [s.headerLineIndex, s]));

  return (
    <div className="repo-git-diff-wrap">
      <pre
        ref={rootRef}
        className="repo-git-diff"
        aria-label="Diff"
        onMouseUp={onMouseUp}
      >
        {lines.map((line, i) => {
          const span = hunkByHeader.get(i);
          return (
            <div
              key={`${i}:${line.type}:${line.text.slice(0, 24)}`}
              className={`repo-git-diff-line repo-git-diff-${line.type}`}
            >
              <span className="repo-git-diff-gutter" aria-hidden>
                {line.type === "add" ? "+" : line.type === "del" ? "−" : line.type === "hunk" ? "@" : " "}
              </span>
              <span className="repo-git-diff-text">{line.text || " "}</span>
              {span && hunkMode && onHunkAction ? (
                <button
                  type="button"
                  className="repo-git-hunk-btn"
                  disabled={hunkBusy}
                  title={hunkMode === "unstage" ? "Unstage hunk" : "Stage hunk"}
                  aria-label={hunkMode === "unstage" ? "Unstage hunk" : "Stage hunk"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onHunkAction({ hunkIndex: span.hunkIndex });
                  }}
                >
                  {hunkMode === "unstage" ? <Minus size={10} /> : <Plus size={10} />}
                  {hunkMode === "unstage" ? "Unstage hunk" : "Stage hunk"}
                </button>
              ) : null}
            </div>
          );
        })}
      </pre>
      {aiPopup && onSendSelectionToAi ? (
        <div
          className="repo-git-diff-ai-pop"
          style={{ left: Math.max(8, aiPopup.x - 60), top: aiPopup.y }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              onSendSelectionToAi(aiPopup.snippet, aiPopup.hint);
              setAiPopup(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <Bot size={12} /> Send to AI
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "2px 6px" }}
            aria-label="Dismiss"
            onClick={() => setAiPopup(null)}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
