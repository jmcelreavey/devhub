"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronUp, Minus, Plus, Search, X } from "lucide-react";
import type { DiffLine } from "@/lib/repos/git-parsers";

export interface DiffHunkAction {
  hunkIndex: number;
  /**
   * Body indexes within the hunk (0 is the @@ header) when the user picked
   * individual lines. Absent means the whole hunk, which is the existing
   * behaviour.
   */
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
}

/**
 * Map each rendered line to its hunk and its index within that hunk's body.
 *
 * The staging API addresses lines by their position inside the hunk, counting
 * the @@ header as 0, so the view has to speak the same coordinates rather than
 * its own flat line numbers.
 */
function buildLineCoords(lines: DiffLine[]): Map<number, { hunkIndex: number; bodyIndex: number }> {
  const coords = new Map<number, { hunkIndex: number; bodyIndex: number }>();
  let hunkIndex = -1;
  let bodyIndex = 0;
  lines.forEach((line, i) => {
    if (line.type === "hunk") {
      hunkIndex += 1;
      bodyIndex = 0;
      return;
    }
    if (hunkIndex < 0) return;
    bodyIndex += 1;
    if (line.type === "add" || line.type === "del") {
      coords.set(i, { hunkIndex, bodyIndex });
    }
  });
  return coords;
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
  /** Rendered line indexes the user has ticked for line-level staging. */
  const [selectedLines, setSelectedLines] = useState<Set<number>>(() => new Set());
  const lineCoords = useMemo(() => buildLineCoords(lines), [lines]);

  // Dismiss a stale AI selection when the diff content changes.
  if (lines !== prevLines) {
    setPrevLines(lines);
    setAiPopup(null);
    // The indexes refer to the diff that just changed underneath them.
    setSelectedLines(new Set());
  }

  const hunkSpans = useMemo(() => buildHunkSpans(lines), [lines]);
  const selectable = Boolean(hunkMode && onHunkAction);

  /**
   * Toggle a line, or extend from the last one with shift.
   *
   * Range select matters more here than it looks: the common shape is a run of
   * adjacent lines belonging to one logical change, and ticking eight of them
   * individually is enough friction to send someone back to `git add -p`.
   */
  const toggleLine = useCallback(
    (index: number, extend: boolean) => {
      setSelectedLines((current) => {
        const next = new Set(current);
        if (extend && current.size > 0) {
          const anchor = Math.max(...current);
          const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
          for (let i = from; i <= to; i += 1) if (lineCoords.has(i)) next.add(i);
          return next;
        }
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    },
    [lineCoords],
  );

  /**
   * Selected lines grouped by hunk, since the staging API takes one hunk at a
   * time. A selection spanning two hunks is applied as two calls.
   */
  const selectionByHunk = useMemo(() => {
    const byHunk = new Map<number, number[]>();
    for (const index of [...selectedLines].sort((a, b) => a - b)) {
      const coord = lineCoords.get(index);
      if (!coord) continue;
      byHunk.set(coord.hunkIndex, [...(byHunk.get(coord.hunkIndex) ?? []), coord.bodyIndex]);
    }
    return byHunk;
  }, [selectedLines, lineCoords]);

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
      {selectable && selectedLines.size > 0 && (
        <div className="repo-git-diff-selection-bar">
          <span>
            {selectedLines.size} line{selectedLines.size === 1 ? "" : "s"} selected
            {selectionByHunk.size > 1 ? ` across ${selectionByHunk.size} hunks` : ""}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={hunkBusy}
            onClick={() => {
              // One call per hunk: the API stages within a single hunk, and a
              // selection is free to span several.
              for (const [hunkIndex, lineIndexes] of selectionByHunk) {
                onHunkAction?.({ hunkIndex, lineIndexes });
              }
              setSelectedLines(new Set());
            }}
          >
            {hunkMode === "unstage" ? <Minus size={10} /> : <Plus size={10} />}
            {hunkMode === "unstage" ? "Unstage lines" : "Stage lines"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "2px 6px" }}
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
          return (
            <div
              key={`${i}:${line.type}:${line.text.slice(0, 24)}`}
              data-diff-line={i}
              data-match={matches.length > 0 && i === activeMatchLine ? "active" : undefined}
              data-selected={selectedLines.has(i) || undefined}
              className={`repo-git-diff-line repo-git-diff-${line.type}${
                selectable && lineCoords.has(i) ? " repo-git-diff-selectable" : ""
              }`}
              onClick={selectable && lineCoords.has(i) ? (e) => toggleLine(i, e.shiftKey) : undefined}
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
