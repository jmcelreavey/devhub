"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, ChevronDown, ChevronUp, MessageSquare, Minus, Plus, Search, X } from "lucide-react";
import type { ElementContent } from "hast";
import { highlightDiffLine, langForPath } from "@/lib/repos/diff-highlight";
import { reviewCommentsStore, useReviewComments, type ReviewComment } from "@/lib/git/review-comments";
import type { DiffLine } from "@/lib/repos/git-parsers";

export type DiffViewMode = "unified" | "split";

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
  /** Repo-relative path — enables syntax highlighting and markdown preview decisions. */
  filePath?: string;
  /** Unified (default) or side-by-side. Parents own the toggle + persistence. */
  view?: DiffViewMode;
  /** Line comments (review basket) — only on surfaces that review working changes. */
  commentsEnabled?: boolean;
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

/** One rendered row in side-by-side mode. */
interface SplitRow {
  kind: "pair" | "wide";
  left?: { index: number; line: DiffLine };
  right?: { index: number; line: DiffLine };
  wide?: { index: number; line: DiffLine };
}

/**
 * Zip del/add runs into side-by-side rows, following git's own ordering
 * (dels before adds within a change block). Context and structural lines span
 * the full width — duplicating a context line into two cells would double
 * every DOM hook (find, selection, popups) for zero visual gain.
 */
export function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: { index: number; line: DiffLine }[] = [];
  let adds: { index: number; line: DiffLine }[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k += 1) rows.push({ kind: "pair", left: dels[k], right: adds[k] });
    dels = [];
    adds = [];
  };
  lines.forEach((line, index) => {
    if (line.type === "del") {
      dels.push({ index, line });
    } else if (line.type === "add") {
      adds.push({ index, line });
    } else {
      flush();
      rows.push({ kind: "wide", wide: { index, line } });
    }
  });
  flush();
  return rows;
}

function renderHast(nodes: ElementContent[], key: string): ReactNode {
  return nodes.map((node, i) => {
    if (node.type === "text") return node.value;
    if (node.type !== "element") return null;
    const classes = node.properties.className;
    return (
      <span key={`${key}:${i}`} className={Array.isArray(classes) ? classes.join(" ") : undefined}>
        {renderHast(node.children, `${key}:${i}`)}
      </span>
    );
  });
}

/** One diff line's code, syntax-highlighted. Falls back to plain text. */
const DiffTokens = memo(function DiffTokens({
  text,
  lang,
  lineKey,
}: {
  text: string;
  lang: string;
  lineKey: string;
}) {
  const nodes = useMemo(() => highlightDiffLine(text, lang), [text, lang]);
  if (!nodes) return <>{text}</>;
  return <>{renderHast(nodes, lineKey)}</>;
});

export function GitDiffView({
  lines,
  emptyMessage = "No diff for this selection.",
  hunkMode,
  hunkBusy,
  onHunkAction,
  onSendSelectionToAi,
  filePath,
  view = "unified",
  commentsEnabled = false,
}: GitDiffViewProps) {
  const rootRef = useRef<HTMLPreElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const aiPopRef = useRef<HTMLDivElement>(null);
  const [aiPopup, setAiPopup] = useState<{
    x: number;
    y: number;
    snippet: string;
    hint: string;
    /** Changed (non-context) lines in the selection — drives the popup label. */
    changed: number;
    /** Rendered line indexes the selection touches, for line-level staging. */
    touchedLines: number[];
  } | null>(null);
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
  const lang = useMemo(() => (filePath ? langForPath(filePath) : null), [filePath]);
  const splitRows = useMemo(
    () => (view === "split" ? buildSplitRows(lines) : null),
    [view, lines],
  );
  const selectable = Boolean(hunkMode && onHunkAction);

  // --- Review comments (line notes shipped to the agent in bulk) ---
  const allComments = useReviewComments();
  const [commentingLine, setCommentingLine] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  const fileComments = useMemo(
    () => (commentsEnabled && filePath ? allComments.filter((c) => c.filePath === filePath) : []),
    [allComments, commentsEnabled, filePath],
  );

  /** Rendered line index → comments anchored to it (via staging coords). */
  const commentsByLine = useMemo(() => {
    const map = new Map<number, ReviewComment[]>();
    if (fileComments.length === 0) return map;
    for (const [lineIndex, coord] of lineCoords) {
      const mine = fileComments.filter(
        (c) => c.hunkIndex === coord.hunkIndex && c.bodyIndex === coord.bodyIndex,
      );
      if (mine.length > 0) map.set(lineIndex, mine);
    }
    return map;
  }, [fileComments, lineCoords]);

  useEffect(() => {
    if (commentingLine !== null) commentInputRef.current?.focus();
  }, [commentingLine]);

  const openCommentEditor = useCallback((lineIndex: number) => {
    setCommentingLine(lineIndex);
    setCommentDraft("");
  }, []);

  const saveComment = useCallback(
    (lineIndex: number) => {
      const text = commentDraft.trim();
      const coord = lineCoords.get(lineIndex);
      if (!filePath || !coord || !text) {
        setCommentingLine(null);
        return;
      }
      const line = lines[lineIndex];
      reviewCommentsStore.add({
        filePath,
        staged: false,
        hunkIndex: coord.hunkIndex,
        bodyIndex: coord.bodyIndex,
        lineText: line && /^[+-\s]/.test(line.text) ? line.text.slice(1).trim() : (line?.text ?? ""),
        lineType: (line?.type as ReviewComment["lineType"]) ?? "ctx",
        text,
      });
      setCommentingLine(null);
      setCommentDraft("");
    },
    [commentDraft, filePath, lineCoords, lines],
  );

  /** Comment display rows + the inline editor, rendered full-width under a line. */
  const commentRowsFor = useCallback(
    (lineIndex: number): ReactNode[] => {
      if (!commentsEnabled) return [];
      const rows: ReactNode[] = [];
      for (const comment of commentsByLine.get(lineIndex) ?? []) {
        rows.push(
          <div key={`comment:${comment.id}`} className="repo-git-diff-wide repo-git-comment-row">
            <MessageSquare size={11} aria-hidden />
            <span className="repo-git-comment-text">{comment.text}</span>
            <span className="repo-git-comment-line" title={comment.lineText}>
              {comment.lineText.slice(0, 60)}
            </span>
            <button
              type="button"
              className="repo-git-comment-delete"
              aria-label="Delete comment"
              onClick={() => reviewCommentsStore.remove(comment.id)}
            >
              <X size={10} aria-hidden />
            </button>
          </div>,
        );
      }
      if (commentingLine === lineIndex) {
        rows.push(
          <div key="comment-editor" className="repo-git-diff-wide repo-git-comment-editor">
            <textarea
              ref={commentInputRef}
              className="input repo-git-comment-input"
              placeholder="Note for the agent — what about this line?"
              value={commentDraft}
              rows={2}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  saveComment(lineIndex);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setCommentingLine(null);
                }
              }}
            />
            <button type="button" className="btn btn-primary" onClick={() => saveComment(lineIndex)}>
              Add
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setCommentingLine(null)}>
              Cancel
            </button>
          </div>,
        );
      }
      return rows;
    },
    [commentsEnabled, commentsByLine, commentingLine, commentDraft, saveComment],
  );

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
   * Selected line indexes grouped by hunk, since the staging API takes one
   * hunk at a time. A selection spanning two hunks is applied as two calls.
   */
  const groupByHunk = useCallback(
    (indexes: Iterable<number>) => {
      const byHunk = new Map<number, number[]>();
      for (const index of [...indexes].sort((a, b) => a - b)) {
        const coord = lineCoords.get(index);
        if (!coord) continue;
        byHunk.set(coord.hunkIndex, [...(byHunk.get(coord.hunkIndex) ?? []), coord.bodyIndex]);
      }
      return byHunk;
    },
    [lineCoords],
  );

  const selectionByHunk = useMemo(() => groupByHunk(selectedLines), [selectedLines, groupByHunk]);

  /** Popup selection grouped by hunk — empty when it touched only context. */
  const popupByHunk = useMemo(
    () => (aiPopup ? groupByHunk(aiPopup.touchedLines) : null),
    [aiPopup, groupByHunk],
  );

  /**
   * Dismiss the popup without touching the text selection — someone who
   * highlighted a few lines to copy them shouldn't lose the highlight just
   * because they waved the menu away.
   */
  const closePopup = useCallback(() => setAiPopup(null), []);

  // Escape and click-away, like every other menu in the app. Without these the
  // only way out was the × glyph, and a click elsewhere in the diff left the
  // popup stranded over content it no longer described.
  useEffect(() => {
    if (!aiPopup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Topmost thing on screen wins the key — don't also close the diff modal.
      e.stopPropagation();
      setAiPopup(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!aiPopRef.current?.contains(e.target as Node)) setAiPopup(null);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [aiPopup]);

  // Keep the popup inside the diff pane. Anchored blind to the cursor, a
  // selection near the right or bottom edge put its buttons under the panel
  // border where they couldn't be clicked.
  useLayoutEffect(() => {
    const el = aiPopRef.current;
    const host = wrapRef.current;
    if (!el || !host || !aiPopup) return;
    const maxLeft = Math.max(8, host.clientWidth - el.offsetWidth - 8);
    const maxTop = Math.max(8, host.clientHeight - el.offsetHeight - 8);
    el.style.left = `${Math.min(Math.max(8, aiPopup.x - 40), maxLeft)}px`;
    el.style.top = `${Math.min(Math.max(8, aiPopup.y), maxTop)}px`;
  }, [aiPopup]);

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

  const openPopup = useCallback(
    (x: number, y: number, snippet: string, touchedLines: number[]) => {
      const changedTouched = touchedLines.filter((i) => lineCoords.has(i)).length;
      const hint =
        changedTouched > 0
          ? `selected ${changedTouched} changed line${changedTouched === 1 ? "" : "s"}`
          : snippet.length > 400
            ? `selection (~${snippet.length} chars — see file)`
            : (() => {
                const n = snippet.split("\n").length;
                return `${n} line${n === 1 ? "" : "s"}`;
              })();
      setAiPopup({
        x,
        y,
        snippet: snippet.slice(0, 2000),
        hint,
        changed: changedTouched,
        touchedLines,
      });
    },
    [lineCoords],
  );

  const onMouseUp = useCallback(() => {
    if (!onSendSelectionToAi || !rootRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      return;
    }
    if (!rootRef.current.contains(sel.anchorNode)) return;
    const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;

    // Which rendered lines the selection actually touches — the raw text's
    // newline count undercounts when a browser merges block boundaries, and
    // staging needs the line indexes anyway.
    const touchedLines: number[] = [];
    if (range) {
      rootRef.current
        .querySelectorAll<HTMLElement>("[data-diff-line]")
        .forEach((el) => {
          const index = Number(el.dataset.diffLine);
          if (Number.isFinite(index) && range.intersectsNode(el)) touchedLines.push(index);
        });
    }

    const rect = range?.getBoundingClientRect();
    const host = rootRef.current.getBoundingClientRect();
    openPopup(
      rect ? rect.left + rect.width / 2 - host.left : 24,
      rect ? rect.bottom - host.top + 8 : 24,
      sel.toString(),
      touchedLines,
    );
  }, [onSendSelectionToAi, openPopup]);

  /**
   * Right-click acts on the clicked line, or on an active text selection.
   * The browser's own menu carries nothing useful inside a diff, and this is
   * where people look for stage/send-to-agent actions first.
   */
  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const host = rootRef.current;
      if (!host) return;
      e.preventDefault();
      e.stopPropagation();
      const target = (e.target as HTMLElement).closest("[data-diff-line]");
      if (!(target instanceof HTMLElement) || !host.contains(target)) return;

      // Click-ticked lines count as a selection here too — right-clicking a
      // 4-line ticked run must stage/send all 4, not just the row under the
      // cursor. Text selections (when present) fold into the same set.
      const picked = new Set(selectedLines);
      let snippet = "";
      const sel = window.getSelection();
      if (
        sel &&
        !sel.isCollapsed &&
        Boolean(sel.toString().trim()) &&
        sel.anchorNode &&
        host.contains(sel.anchorNode)
      ) {
        const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        if (range) {
          host.querySelectorAll<HTMLElement>("[data-diff-line]").forEach((el) => {
            const index = Number(el.dataset.diffLine);
            if (Number.isFinite(index) && range.intersectsNode(el)) picked.add(index);
          });
        }
        snippet = sel.toString();
      }
      if (picked.size === 0) {
        const index = Number(target.dataset.diffLine);
        if (!Number.isFinite(index)) return;
        picked.add(index);
      }
      if (!snippet) {
        snippet = [...picked].sort((a, b) => a - b).map((i) => lines[i]?.text ?? "").join("\n");
      }
      const touched = [...picked].sort((a, b) => a - b);
      const hostRect = host.getBoundingClientRect();
      openPopup(e.clientX - hostRect.left, e.clientY - hostRect.top + 8, snippet, touched);
    },
    [openPopup, selectedLines, lines],
  );

  if (lines.length === 0 || lines.every((l) => !l.text.trim())) {
    return <div className="repo-git-diff-empty">{emptyMessage}</div>;
  }

  const hunkByHeader = new Map(hunkSpans.map((s) => [s.headerLineIndex, s]));

  const renderLineCell = (entry: { index: number; line: DiffLine } | undefined, side: "left" | "right" | "wide") => {
    if (!entry) {
      return <div key={`${side}-void`} className="repo-git-diff-line repo-git-diff-void" aria-hidden />;
    }
    const { index: i, line } = entry;
    const span = hunkByHeader.get(i);
    const isCode = line.type === "add" || line.type === "del" || line.type === "ctx";
    // The parser keeps the +/-/space marker in `text`; the gutter already
    // shows it, so the code span renders the bare line (also what highlighting
    // needs — a leading "+" would tokenize as an operator).
    const bodyText = isCode && /^[+-\s]/.test(line.text) ? line.text.slice(1) : line.text;
    return (
      <div
        key={`${i}:${line.type}:${line.text.slice(0, 24)}`}
        data-diff-line={i}
        data-match={matches.length > 0 && i === activeMatchLine ? "active" : undefined}
        data-selected={selectedLines.has(i) || undefined}
        className={`repo-git-diff-line repo-git-diff-${line.type}${
          selectable && lineCoords.has(i) ? " repo-git-diff-selectable" : ""
        }${side === "wide" ? " repo-git-diff-wide" : ""}`}
        onClick={selectable && lineCoords.has(i) ? (e) => toggleLine(i, e.shiftKey) : undefined}
      >
        <span className="repo-git-diff-gutter" aria-hidden>
          {line.type === "add" ? "+" : line.type === "del" ? "−" : line.type === "hunk" ? "@" : " "}
        </span>
        <span className="repo-git-diff-text">
          {lang && isCode && bodyText ? (
            <DiffTokens text={bodyText} lang={lang} lineKey={String(i)} />
          ) : (
            bodyText || " "
          )}
        </span>
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
        {commentsEnabled && lineCoords.has(i) ? (
          <button
            type="button"
            className="repo-git-comment-btn"
            title="Comment on this line"
            aria-label={`Comment on line ${i + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              openCommentEditor(i);
            }}
          >
            <MessageSquare size={11} aria-hidden />
          </button>
        ) : null}
      </div>
    );
  };

  // "3 changed lines · 2 hunks". The hunk count earns its place: staging a
  // cross-hunk selection fires one API call per hunk, so the split is worth
  // seeing before you commit to it.
  const popupLabel = !aiPopup
    ? ""
    : aiPopup.changed > 0
      ? `${aiPopup.changed} changed line${aiPopup.changed === 1 ? "" : "s"}${
          popupByHunk && popupByHunk.size > 1 ? ` · ${popupByHunk.size} hunks` : ""
        }`
      : aiPopup.hint;
  const stageLabel = hunkMode === "unstage" ? "Unstage lines" : "Stage lines";

  return (
    <div ref={wrapRef} className="repo-git-diff-wrap" onKeyDownCapture={onKeyDownCapture}>
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
            {stageLabel}
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
        className={`repo-git-diff${view === "split" ? " repo-git-diff-split" : ""}`}
        aria-label="Diff"
        onMouseUp={onMouseUp}
        onContextMenu={onContextMenu}
      >
        {splitRows
          ? splitRows.flatMap((row) => {
              const cells =
                row.kind === "wide"
                  ? [renderLineCell(row.wide, "wide")]
                  : [renderLineCell(row.left, "left"), renderLineCell(row.right, "right")];
              const anchors = [row.left?.index, row.right?.index, row.wide?.index];
              const extras = anchors.flatMap((index) => (index === undefined ? [] : commentRowsFor(index)));
              return [...cells, ...extras];
            })
          : lines.flatMap((line, i) => [renderLineCell({ index: i, line }, "wide"), ...commentRowsFor(i)])}
      </pre>
      {aiPopup && (onSendSelectionToAi || selectable) ? (
        <div
          ref={aiPopRef}
          className="repo-git-diff-ai-pop"
          role="group"
          aria-label="Selection actions"
          style={{ left: Math.max(8, aiPopup.x - 40), top: aiPopup.y }}
        >
          <div className="repo-git-diff-ai-pop-head">
            <span className="repo-git-diff-ai-pop-hint">{popupLabel}</span>
            <button
              type="button"
              className="repo-git-diff-ai-pop-close"
              aria-label="Dismiss"
              title="Dismiss (Esc)"
              onClick={closePopup}
            >
              <X size={11} aria-hidden />
            </button>
          </div>
          {/* Staging leads: in a stageable diff it's the reason the menu is
              open, and a context-only selection has nothing to stage. */}
          {selectable && popupByHunk && popupByHunk.size > 0 && (
            <button
              type="button"
              className="repo-git-diff-ai-pop-item"
              data-primary
              disabled={hunkBusy}
              title={`${stageLabel} — exactly the lines you picked`}
              onClick={() => {
                for (const [hunkIndex, lineIndexes] of popupByHunk) {
                  onHunkAction?.({ hunkIndex, lineIndexes });
                }
                setAiPopup(null);
                setSelectedLines(new Set());
                window.getSelection()?.removeAllRanges();
              }}
            >
              {hunkMode === "unstage" ? (
                <Minus size={12} aria-hidden />
              ) : (
                <Plus size={12} aria-hidden />
              )}
              {stageLabel}
            </button>
          )}
          {commentsEnabled && aiPopup.touchedLines.length > 0 && (
            <button
              type="button"
              className="repo-git-diff-ai-pop-item"
              title="Attach a review note to the first selected line"
              onClick={() => {
                openCommentEditor(Math.min(...aiPopup.touchedLines));
                setAiPopup(null);
              }}
            >
              <MessageSquare size={12} aria-hidden /> Comment
            </button>
          )}
          {onSendSelectionToAi && (
            <button
              type="button"
              className="repo-git-diff-ai-pop-item"
              title="Hand this selection to the agent as context"
              onClick={() => {
                onSendSelectionToAi(aiPopup.snippet, aiPopup.hint);
                setAiPopup(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              <Bot size={12} aria-hidden /> Send to AI
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
