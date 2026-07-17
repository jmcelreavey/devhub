"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Bot, Minus, Plus } from "lucide-react";
import type { DiffLine } from "@/lib/repo-git-parsers";

export interface DiffHunkAction {
  hunkIndex: number;
  /** Indexes into the hunk body (absolute indexes in the rendered line list's hunk). */
  lineIndexes?: number[];
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
  start: number;
  end: number; // exclusive
}

function buildHunkSpans(lines: DiffLine[]): HunkSpan[] {
  const spans: HunkSpan[] = [];
  let current: HunkSpan | null = null;
  let hunkIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.type === "hunk") {
      if (current) {
        current.end = i;
        spans.push(current);
      }
      current = { hunkIndex, headerLineIndex: i, start: i, end: lines.length };
      hunkIndex++;
    } else if (line.type === "meta" && current) {
      current.end = i;
      spans.push(current);
      current = null;
    }
  }
  if (current) spans.push(current);
  return spans;
}

/** Map a rendered line index within a hunk to the patch body index (0 = @@ header). */
function patchBodyIndex(span: HunkSpan, lineIndex: number): number {
  return lineIndex - span.headerLineIndex;
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
  const [selectedLines, setSelectedLines] = useState<Set<number>>(() => new Set());
  const [aiPopup, setAiPopup] = useState<{ x: number; y: number; snippet: string; hint: string } | null>(
    null,
  );
  const lastClick = useRef<{ lines: DiffLine[]; index: number } | null>(null);
  const [prevLines, setPrevLines] = useState(lines);

  // Reset selection when the diff content changes (adjust state during render).
  if (lines !== prevLines) {
    setPrevLines(lines);
    setSelectedLines(new Set());
    setAiPopup(null);
  }

  const hunkSpans = useMemo(() => buildHunkSpans(lines), [lines]);
  const lineToHunk = useMemo(() => {
    const map = new Map<number, HunkSpan>();
    for (const span of hunkSpans) {
      for (let i = span.start; i < span.end; i++) map.set(i, span);
    }
    return map;
  }, [hunkSpans]);

  const toggleLine = useCallback(
    (index: number, shiftKey: boolean) => {
      const line = lines[index];
      if (!line || (line.type !== "add" && line.type !== "del")) return;
      setSelectedLines((prev) => {
        const next = new Set(prev);
        const anchor =
          lastClick.current?.lines === lines ? lastClick.current.index : null;
        if (shiftKey && anchor !== null) {
          const lo = Math.min(anchor, index);
          const hi = Math.max(anchor, index);
          for (let i = lo; i <= hi; i++) {
            const t = lines[i]?.type;
            if (t === "add" || t === "del") next.add(i);
          }
        } else if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
      lastClick.current = { lines, index };
      setAiPopup(null);
    },
    [lines],
  );

  const stageSelected = useCallback(() => {
    if (!onHunkAction || selectedLines.size === 0) return;
    // Group by hunk — only act on the first hunk with selections (keep it simple).
    const byHunk = new Map<number, number[]>();
    for (const idx of selectedLines) {
      const span = lineToHunk.get(idx);
      if (!span) continue;
      const list = byHunk.get(span.hunkIndex) ?? [];
      list.push(patchBodyIndex(span, idx));
      byHunk.set(span.hunkIndex, list);
    }
    const first = [...byHunk.entries()][0];
    if (!first) return;
    const [hunkIndex, lineIndexes] = first;
    onHunkAction({ hunkIndex, lineIndexes });
    setSelectedLines(new Set());
  }, [onHunkAction, selectedLines, lineToHunk]);

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
  const showLineStage = Boolean(hunkMode && onHunkAction && selectedLines.size > 0);

  return (
    <div className="repo-git-diff-wrap">
      {showLineStage && (
        <div className="repo-git-diff-selection-bar">
          <span>{selectedLines.size} line{selectedLines.size === 1 ? "" : "s"}</span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={hunkBusy}
            onClick={() => stageSelected()}
          >
            {hunkMode === "unstage" ? (
              <>
                <Minus size={11} /> Unstage lines
              </>
            ) : (
              <>
                <Plus size={11} /> Stage lines
              </>
            )}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setSelectedLines(new Set())}
          >
            Clear
          </button>
        </div>
      )}
      <pre
        ref={rootRef}
        className="repo-git-diff"
        aria-label="Diff"
        onMouseUp={onMouseUp}
      >
        {lines.map((line, i) => {
          const span = hunkByHeader.get(i);
          const selectable = line.type === "add" || line.type === "del";
          const isSelected = selectedLines.has(i);
          return (
            <div
              key={`${i}:${line.type}:${line.text.slice(0, 24)}`}
              className={[
                "repo-git-diff-line",
                `repo-git-diff-${line.type}`,
                isSelected ? "repo-git-diff-selected" : "",
                selectable && hunkMode ? "repo-git-diff-selectable" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={
                selectable && hunkMode
                  ? (e) => {
                      e.preventDefault();
                      toggleLine(i, e.shiftKey);
                    }
                  : undefined
              }
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
