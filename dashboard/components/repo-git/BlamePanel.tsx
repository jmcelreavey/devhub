"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, EyeOff, History as HistoryIcon, RefreshCw } from "lucide-react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { fieldMatchScore } from "@/lib/command-palette-score";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { useVirtualRows } from "@/lib/hooks/use-virtual-rows";
import { CommitContextChips } from "./CommitContextChips";
import { RepoFileOpenMenu } from "./RepoFileOpenMenu";
import { fetchGitJson, repoApi } from "./shared";

interface BlameLine {
  hash: string;
  author: string;
  date: string;
  lineNumber: number;
  content: string;
}

interface BlameHistoryEntry {
  hash?: string;
  shortHash: string;
  subject: string;
  author: string;
  relativeDate: string;
}

interface BlamePayload {
  path: string;
  commit: string | null;
  line: number | null;
  lines: BlameLine[];
  history: BlameHistoryEntry[];
  historyScope: "file" | "line";
  hasIgnoreRevs?: boolean;
  ignoringRevs?: boolean;
}

interface BlameView {
  path: string;
  commit: string | null;
  line: number | null;
}

const SUGGESTION_LIMIT = 12;
/** Commits shown in the file/line history strip. */
const HISTORY_LIMIT = 12;
/** Must match `.repo-git-blame-line { height }` in globals.css. */
const BLAME_ROW_H = 18;

function scoreTrackedPath(query: string, filePath: string): number {
  const base = filePath.split("/").pop() ?? filePath;
  return Math.max(fieldMatchScore(query, filePath), fieldMatchScore(query, base));
}

function blameUrl(repoName: string, view: BlameView, ignoreRevs: boolean): string {
  const qs = new URLSearchParams({ path: view.path });
  if (view.commit) qs.set("commit", view.commit);
  if (view.line) qs.set("line", String(view.line));
  if (!ignoreRevs) qs.set("ignoreRevs", "0");
  return repoApi(repoName, `/git/blame?${qs}`);
}

export function BlamePanel({
  repoName,
  onOpenInHistory,
}: {
  repoName: string;
  /** Jump to a commit in the History tab. Omitted when there's nowhere to jump to. */
  onOpenInHistory?: (hash: string) => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<BlameView | null>(null);
  const [stack, setStack] = useState<BlameView[]>([]);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<BlameLine[]>([]);
  const [history, setHistory] = useState<BlameHistoryEntry[]>([]);
  const [historyScope, setHistoryScope] = useState<"file" | "line">("file");
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [ignoreRevs, setIgnoreRevs] = useState(true);
  const [hasIgnoreRevs, setHasIgnoreRevs] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Monotonic token: clicking through lines fires overlapping blame requests and
  // git is slow enough that they finish out of order. Only the newest may apply.
  const requestSeq = useRef(0);
  const suggestionListId = useId();
  const { scrollRef, window: rows } = useVirtualRows(lines.length, BLAME_ROW_H);

  const { data: filesPayload } = useLive<{ files: string[] }>(
    repoApi(repoName, "/git/files"),
    { revalidateOnFocus: false, refreshInterval: 0 },
  );
  const suggestions = useMemo(() => {
    const files = filesPayload?.files ?? [];
    const q = query.trim();
    if (!q || files.length === 0) return [];
    return files
      .map((filePath) => ({ filePath, score: scoreTrackedPath(q, filePath) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))
      .slice(0, SUGGESTION_LIMIT)
      .map((row) => row.filePath);
  }, [filesPayload?.files, query]);

  useEffect(() => {
    if (!suggestOpen) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [suggestOpen]);

  /** `ignoreRevsOverride` lets the toggle reload with its new value before state settles. */
  async function load(
    next: BlameView,
    opts?: { pushStack?: boolean },
    ignoreRevsOverride?: boolean,
  ) {
    const filePath = next.path.trim();
    if (!filePath) {
      toast.error("Enter a file path");
      return;
    }
    setSuggestOpen(false);
    setLoading(true);
    const seq = ++requestSeq.current;
    try {
      if (opts?.pushStack && view) {
        setStack((prev) => [...prev, view]);
      }
      const json = await fetchGitJson<BlamePayload>(
        blameUrl(repoName, { ...next, path: filePath }, ignoreRevsOverride ?? ignoreRevs),
      );
      if (seq !== requestSeq.current) return;
      setHasIgnoreRevs(json.hasIgnoreRevs === true);
      setLines(json.lines ?? []);
      setHistory(json.history ?? []);
      setHistoryScope(json.historyScope === "line" ? "line" : "file");
      setView({
        path: json.path || filePath,
        commit: json.commit,
        line: json.line,
      });
      setSelectedLine(json.line);
      setQuery(json.path || filePath);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      toast.error(err instanceof Error ? err.message : "Blame failed");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  function pickSuggestion(filePath: string) {
    setQuery(filePath);
    setStack([]);
    void load({ path: filePath, commit: null, line: null });
  }

  function goBack() {
    // Pop outside the updater — a state updater must be pure, and firing the
    // fetch from inside it double-loaded under StrictMode's double invocation.
    const prior = stack[stack.length - 1];
    if (!prior) return;
    setStack((prev) => prev.slice(0, -1));
    void load(prior);
  }

  async function selectLine(line: BlameLine) {
    if (!view) return;
    setSelectedLine(line.lineNumber);
    await load(
      { path: view.path, commit: view.commit, line: line.lineNumber },
      { pushStack: view.line !== line.lineNumber },
    );
  }

  async function openHistoryCommit(entry: BlameHistoryEntry) {
    if (!view) return;
    const commit = entry.hash || entry.shortHash;
    if (!commit) return;
    await load(
      { path: view.path, commit, line: view.line },
      { pushStack: true },
    );
  }

  async function blamePrevious() {
    if (!view || selectedLine == null) return;
    const row = lines.find((l) => l.lineNumber === selectedLine) ?? lines[0];
    if (!row?.hash) {
      toast.error("No commit on this line");
      return;
    }
    // Parent of the line's introducing commit — classic "blame previous".
    await load(
      { path: view.path, commit: `${row.hash}^`, line: selectedLine },
      { pushStack: true },
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (suggestOpen && suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSuggestOpen(false);
        return;
      }
      if (event.key === "Enter") {
        const idx = Math.min(activeIndex, suggestions.length - 1);
        if (suggestions[idx]) {
          event.preventDefault();
          pickSuggestion(suggestions[idx]!);
          return;
        }
      }
    }
  }

  const showSuggestions = suggestOpen && query.trim().length > 0 && suggestions.length > 0;
  const highlightIndex =
    suggestions.length === 0 ? 0 : Math.min(activeIndex, suggestions.length - 1);
  const path = view?.path ?? "";

  return (
    <div className="repo-git-blame">
      <form
        className="repo-git-changes-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (showSuggestions && suggestions[highlightIndex]) {
            pickSuggestion(suggestions[highlightIndex]!);
            return;
          }
          setStack([]);
          void load({ path: query, commit: null, line: null });
        }}
      >
        <div className="repo-git-blame-path-wrap" ref={wrapRef}>
          <input
            className="input"
            style={{ fontSize: 12, width: "100%", minWidth: 0 }}
            placeholder="Search path… e.g. BlamePanel or route.ts"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
              setSuggestOpen(true);
            }}
            onFocus={() => setSuggestOpen(true)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls={suggestionListId}
            aria-activedescendant={
              showSuggestions ? `${suggestionListId}-${highlightIndex}` : undefined
            }
            autoComplete="off"
            spellCheck={false}
          />
          {showSuggestions && (
            <ul id={suggestionListId} className="repo-git-blame-suggestions" role="listbox">
              {suggestions.map((filePath, index) => (
                <li
                  key={filePath}
                  id={`${suggestionListId}-${index}`}
                  role="option"
                  aria-selected={index === highlightIndex}
                >
                  <button
                    type="button"
                    className="repo-git-blame-suggestion"
                    data-active={index === highlightIndex || undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => pickSuggestion(filePath)}
                  >
                    <span className="truncate">{filePath}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? <RefreshCw size={11} className="animate-spin" /> : "Blame"}
        </button>
        {hasIgnoreRevs ? (
          <button
            type="button"
            className="btn btn-ghost"
            data-active={ignoreRevs || undefined}
            aria-pressed={ignoreRevs}
            disabled={loading || !view}
            title={
              ignoreRevs
                ? "Ignoring revisions listed in .git-blame-ignore-revs (formatting sweeps). Click to include them."
                : "Including every commit, formatting sweeps included. Click to honour .git-blame-ignore-revs."
            }
            onClick={() => {
              const next = !ignoreRevs;
              setIgnoreRevs(next);
              if (view) void load(view, undefined, next);
            }}
          >
            <EyeOff size={11} aria-hidden />
            {ignoreRevs ? "Ignoring sweeps" : "All commits"}
          </button>
        ) : null}
        {path && lines.length > 0 ? (
          <RepoFileOpenMenu
            repoName={repoName}
            filePath={path}
            commit={view?.commit ?? undefined}
            disabled={loading}
          />
        ) : null}
      </form>

      {(stack.length > 0 || view?.commit || view?.line) && (
        <div className="repo-git-blame-crumb">
          {stack.length > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={goBack} disabled={loading}>
              <ChevronLeft size={12} /> Back
            </button>
          ) : null}
          <span>
            {view?.commit ? (
              <>
                at <span className="font-mono text-accent">{view.commit.slice(0, 7)}</span>
              </>
            ) : (
              "HEAD"
            )}
            {view?.line ? (
              <>
                {" "}
                · line <span className="font-mono text-accent">{view.line}</span>
              </>
            ) : null}
          </span>
          {selectedLine != null ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loading}
              title="Blame the parent of this line's commit"
              onClick={() => void blamePrevious()}
            >
              Blame previous
            </button>
          ) : null}
          {onOpenInHistory && view?.commit ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loading}
              title="Open this revision in History"
              onClick={() => onOpenInHistory(view.commit!)}
            >
              <HistoryIcon size={11} aria-hidden /> In History
            </button>
          ) : null}
        </div>
      )}

      {view?.commit ? <CommitContextChips repoName={repoName} commit={view.commit} /> : null}

      {history.length > 0 && (
        <div className="repo-git-blame-history">
          <div className="repo-git-section-label" style={{ padding: "0 0 4px" }}>
            {historyScope === "line" ? "Line history" : "File history"}
            <span className="repo-git-section-label-end">{history.length}</span>
          </div>
          {history.slice(0, HISTORY_LIMIT).map((h) => (
            <div
              key={h.hash || h.shortHash}
              className="repo-git-blame-history-item"
              data-active={view?.commit === h.hash || view?.commit === h.shortHash || undefined}
            >
              <button
                type="button"
                className="repo-git-blame-history-row"
                onClick={() => void openHistoryCommit(h)}
                title="Blame file at this commit"
              >
                <span className="font-mono text-accent">{h.shortHash}</span>
                <span className="truncate">{h.subject}</span>
                <span className="text-text-subtle">{h.relativeDate}</span>
              </button>
              {onOpenInHistory ? (
                <button
                  type="button"
                  className="repo-git-blame-history-open"
                  title="Open this commit in History — see everything it changed"
                  aria-label={`Open ${h.shortHash} in History`}
                  onClick={() => onOpenInHistory(h.hash || h.shortHash)}
                >
                  <HistoryIcon size={11} aria-hidden />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {loading && lines.length === 0 ? (
        <SkeletonRows count={10} height={16} />
      ) : lines.length === 0 ? (
        <div className="repo-git-empty">
          Type part of a filename to find a tracked path, then blame it. Click a line for its
          history; click a commit to drill in.
        </div>
      ) : (
        <div className="repo-git-blame-table" ref={scrollRef}>
          {/* Windowed: a 5k-line file would otherwise mount 5k focusable rows. */}
          <div style={{ height: rows.padTop }} aria-hidden />
          {lines.slice(rows.start, rows.end).map((l) => (
            <button
              key={`${l.lineNumber}-${l.hash}`}
              type="button"
              className="repo-git-blame-line"
              data-active={selectedLine === l.lineNumber || undefined}
              onClick={() => void selectLine(l)}
              title="Show history for this line"
            >
              <span className="repo-git-blame-meta font-mono" title={`${l.author} · ${l.date}`}>
                {l.hash}
              </span>
              <span className="repo-git-blame-author truncate">{l.author}</span>
              <span className="repo-git-blame-num">{l.lineNumber}</span>
              <code className="repo-git-blame-code">{l.content}</code>
            </button>
          ))}
          <div style={{ height: rows.padBottom }} aria-hidden />
        </div>
      )}
    </div>
  );
}
