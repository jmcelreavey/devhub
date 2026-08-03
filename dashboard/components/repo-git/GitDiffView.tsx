"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronUp, Minus, Plus, Search, X } from "lucide-react";
import type { DiffLine } from "@/lib/repos/git-parsers";

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

  const [find, setFind] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  /** Indices of lines containing the needle, in document order. */
  const matches = useMemo(() => {
    const needle = find.trim().toLowerCase();
    if (!needle) return [];
    const out: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.text.toLowerCase().includes(needle)) out.push(i);
    }
    return out;
  }, [find, lines]);

  const activeMatchLine = matches.length > 0 ? matches[matchIndex % matches.length] : -1;

  // Keep the current match on screen as the user steps through.
  useEffect(() => {
    if (activeMatchLine < 0) return;
    rootRef.current
      ?.querySelector(`[data-diff-line="${activeMatchLine}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [activeMatchLine]);

  const step = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      setMatchIndex((i) => (i + delta + matches.length) % matches.length);
    },
    [matches.length],
  );

  const openFind = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => findInputRef.current?.select());
  }, []);

  // ⌘F / Ctrl-F while the pointer is in a diff searches the diff rather than
  // the whole page — the browser's own find can't see virtualized/overflowed rows.
  const onKeyDownCapture = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        openFind();
      }
    },
    [openFind],
  );

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
    <div className="repo-git-diff-wrap" onKeyDownCapture={onKeyDownCapture}>
      {findOpen ? (
        <div className="repo-git-diff-find" role="search">
          <Search size={12} aria-hidden />
          <input
            ref={findInputRef}
            className="input repo-git-diff-find-input"
            type="search"
            placeholder="Find in diff…"
            value={find}
            aria-label="Find in diff"
            onChange={(e) => {
              setFind(e.target.value);
              setMatchIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setFindOpen(false);
                setFind("");
              }
            }}
          />
          <span className="repo-git-diff-find-count" aria-live="polite">
            {find.trim() ? (matches.length ? `${(matchIndex % matches.length) + 1}/${matches.length}` : "0") : ""}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={matches.length === 0}
            aria-label="Previous match"
            onClick={() => step(-1)}
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={matches.length === 0}
            aria-label="Next match"
            onClick={() => step(1)}
          >
            <ChevronDown size={12} />
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label="Close find"
            onClick={() => {
              setFindOpen(false);
              setFind("");
            }}
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-ghost repo-git-diff-find-open"
          title="Find in diff (⌘F)"
          aria-label="Find in diff"
          onClick={openFind}
        >
          <Search size={12} />
        </button>
      )}
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
              data-diff-line={i}
              data-match={matches.length > 0 && i === activeMatchLine ? "active" : undefined}
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
