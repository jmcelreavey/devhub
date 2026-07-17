"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, RefreshCw, RotateCcw, Search, Upload } from "lucide-react";
import { SkeletonRows } from "@/components/SkeletonRows";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/lib/use-toast";
import type { DiffLine } from "@/lib/repo-git-parsers";
import type { GraphLaneCommit } from "@/lib/repo-git-graph";
import { CommitGraph } from "./CommitGraph";
import { GitDiffView } from "./GitDiffView";
import {
  fetchGitJson,
  postGitAction,
  repoApi,
  type BranchesPayload,
} from "./shared";

interface CommitShowPayload {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  date: string;
  relativeDate: string;
  parents: string[];
  files: { path: string; status: string }[];
  path: string | null;
  lines: DiffLine[];
  empty: boolean;
  isHead?: boolean;
  isAncestorOfHead?: boolean;
  aheadCount?: number;
}

export function HistoryPanel({
  repoName,
  onMutate,
  focusUnpushed = false,
  onFocusUnpushedConsumed,
}: {
  repoName: string;
  onMutate: () => void;
  focusUnpushed?: boolean;
  onFocusUnpushedConsumed?: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [commits, setCommits] = useState<GraphLaneCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [authorFilter, setAuthorFilter] = useState("");
  const [search, setSearch] = useState("");
  const [unpushedOnly, setUnpushedOnly] = useState(false);
  const [unpushedHashes, setUnpushedHashes] = useState<Set<string>>(() => new Set());
  const [detail, setDetail] = useState<CommitShowPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [logJson, branchJson] = await Promise.all([
        fetchGitJson<{ commits: GraphLaneCommit[] }>(repoApi(repoName, "/git/log?limit=80")),
        fetchGitJson<BranchesPayload>(repoApi(repoName, "/branches")).catch(() => null),
      ]);
      setCommits(logJson.commits ?? []);
      setSelected((prev) => prev ?? logJson.commits?.[0]?.hash ?? null);

      if (branchJson) {
        const next = new Set<string>();
        for (const c of branchJson.unpushedCommits ?? []) {
          if (c.hash) next.add(c.hash);
          if (c.shortHash) next.add(c.shortHash);
        }
        setUnpushedHashes(next);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "History failed");
    } finally {
      setLoading(false);
    }
  }, [repoName, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch log on mount / repo change
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!focusUnpushed) return;
    setUnpushedOnly(true); // eslint-disable-line react-hooks/set-state-in-effect -- badge navigates into unpushed filter
    onFocusUnpushedConsumed?.();
  }, [focusUnpushed, onFocusUnpushedConsumed]);

  const authors = useMemo(() => {
    const set = new Set<string>();
    for (const c of commits) {
      if (c.author.trim()) set.add(c.author);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [commits]);

  const isUnpushed = useCallback(
    (c: GraphLaneCommit) => unpushedHashes.has(c.hash) || unpushedHashes.has(c.shortHash),
    [unpushedHashes],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return commits.filter((c) => {
      if (unpushedOnly && !isUnpushed(c)) return false;
      if (authorFilter && c.author !== authorFilter) return false;
      if (!q) return true;
      return (
        c.subject.toLowerCase().includes(q) ||
        c.hash.toLowerCase().includes(q) ||
        c.shortHash.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q)
      );
    });
  }, [commits, authorFilter, search, unpushedOnly, isUnpushed]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelected(null); // eslint-disable-line react-hooks/set-state-in-effect -- clear selection when filter empties
      return;
    }
    setSelected((prev) => (prev && filtered.some((c) => c.hash === prev) ? prev : filtered[0]!.hash));
  }, [filtered]);

  useEffect(() => {
    if (!selected) {
      setDetail(null); // eslint-disable-line react-hooks/set-state-in-effect -- clear detail when nothing selected
      setSelectedFile(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void (async () => {
      try {
        const params = new URLSearchParams({ commit: selected });
        if (selectedFile) params.set("path", selectedFile);
        const json = await fetchGitJson<CommitShowPayload>(
          repoApi(repoName, `/git/show?${params.toString()}`),
        );
        if (!cancelled) setDetail(json);
      } catch (err) {
        if (!cancelled) {
          setDetail(null);
          toast.error(err instanceof Error ? err.message : "Commit detail failed");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoName, selected, selectedFile, toast]);

  /** POST a branches action with confirm + toasts (undo-commit / reset-stash-ahead). */
  async function confirmedBranchesAction(opts: {
    actingKey: string;
    confirmTitle: string;
    confirmMessage: string;
    confirmLabel: string;
    body: Record<string, unknown>;
    successToast: (json: Record<string, unknown>) => string;
    failLabel: string;
    onSuccess?: () => void;
  }) {
    const ok = await confirm({
      title: opts.confirmTitle,
      message: opts.confirmMessage,
      confirmLabel: opts.confirmLabel,
      variant: "danger",
    });
    if (!ok) return;
    setActing(opts.actingKey);
    try {
      const result = await postGitAction<Record<string, unknown>>(
        repoApi(repoName, "/branches"),
        opts.body,
      );
      if (!result.ok) throw new Error(result.kind === "error" ? result.message : result.kind);
      toast.success(opts.successToast(result.json));
      opts.onSuccess?.();
      onMutate();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : opts.failLabel);
    } finally {
      setActing(null);
    }
  }

  async function undo() {
    await confirmedBranchesAction({
      actingKey: "undo",
      confirmTitle: "Undo last commit?",
      confirmMessage:
        "Soft reset (git reset --soft HEAD~1). Changes stay staged. Does not touch the remote.",
      confirmLabel: "Undo",
      body: { action: "undo-commit" },
      successToast: () => "Undid last commit (soft)",
      failLabel: "Undo failed",
    });
  }

  async function resetStashAhead() {
    if (!detail || !selected || detail.hash !== selected) return;
    if (detail.isHead || !detail.isAncestorOfHead || !(detail.aheadCount && detail.aheadCount > 0)) {
      return;
    }
    const ahead = detail.aheadCount;
    const short = detail.shortHash;
    await confirmedBranchesAction({
      actingKey: "reset-stash",
      confirmTitle: "Stash ahead & reset?",
      confirmMessage: `${ahead} commit${ahead === 1 ? "" : "s"} ahead of ${short} will be stashed, then this branch resets to that commit. Working tree must be clean. Does not touch the remote.`,
      confirmLabel: "Stash & reset",
      body: { action: "reset-stash-ahead", commit: detail.hash },
      successToast: (json) => {
        const j = json as {
          stashRef?: string | null;
          stashMessage?: string | null;
          shortHash?: string;
          aheadCount?: number;
          message?: string;
        };
        const stashBit = j.stashRef
          ? ` · ${j.stashRef}${j.stashMessage ? ` “${j.stashMessage}”` : ""}`
          : "";
        return (
          j.message ??
          `Reset to ${j.shortHash ?? short}; stashed ${j.aheadCount ?? ahead} commit${
            (j.aheadCount ?? ahead) === 1 ? "" : "s"
          }${stashBit}`
        );
      },
      failLabel: "Reset & stash failed",
      onSuccess: () => setSelectedFile(null),
    });
  }

  if (loading && commits.length === 0) return <SkeletonRows count={8} height={32} />;

  const selectedCommit = commits.find((c) => c.hash === selected) ?? null;
  const hasFilters = Boolean(authorFilter || search.trim() || unpushedOnly);
  const detailForSelection = detail && selected && detail.hash === selected ? detail : null;
  const activeFile = selectedFile ?? detailForSelection?.path ?? null;
  const canResetStashAhead =
    Boolean(detailForSelection) &&
    detailForSelection?.isHead !== true &&
    detailForSelection?.isAncestorOfHead === true &&
    (detailForSelection?.aheadCount ?? 0) > 0;
  const showDivergedNote =
    Boolean(detailForSelection) &&
    detailForSelection?.isHead !== true &&
    detailForSelection?.isAncestorOfHead === false;

  return (
    <div className="repo-git-history">
      <div className="repo-git-changes-toolbar">
        <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
          <RefreshCw size={11} className={loading ? "animate-spin" : undefined} /> Refresh
        </button>
        <button type="button" className="btn btn-ghost" disabled={acting !== null} onClick={() => void undo()}>
          {acting === "undo" ? <RefreshCw size={11} className="animate-spin" /> : <RotateCcw size={11} />}
          Undo last commit
        </button>
        {unpushedHashes.size > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            data-active={unpushedOnly || undefined}
            aria-pressed={unpushedOnly}
            onClick={() => setUnpushedOnly((v) => !v)}
            title={unpushedOnly ? "Show all commits" : "Show only unpushed commits"}
          >
            <Upload size={11} />
            {unpushedOnly ? "Unpushed only" : "Unpushed"}
          </button>
        )}
        <div className="repo-git-spacer" />
        <label className="repo-git-filter">
          <span className="sr-only">Author</span>
          <select
            className="input repo-git-filter-select"
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
            aria-label="Filter by author"
          >
            <option value="">All authors</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="repo-git-filter repo-git-filter-search">
          <Search size={12} aria-hidden />
          <span className="sr-only">Search commits</span>
          <input
            className="input repo-git-filter-input"
            type="search"
            placeholder="Search message or hash…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search commits"
          />
        </label>
      </div>
      {hasFilters && (
        <div className="repo-git-filter-meta">
          Showing {filtered.length} of {commits.length} commit{commits.length === 1 ? "" : "s"}
          {unpushedOnly ? " · unpushed" : ""}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "2px 6px" }}
            onClick={() => {
              setAuthorFilter("");
              setSearch("");
              setUnpushedOnly(false);
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      <div className="repo-git-history-split">
        <div className="repo-git-history-list">
          <CommitGraph
            commits={filtered}
            selectedHash={selected}
            onSelect={(hash) => {
              setSelectedFile(null);
              setSelected(hash);
            }}
            unpushedHashes={unpushedHashes}
          />
        </div>
        <div className="repo-git-history-detail">
          {!selected ? (
            <div className="repo-git-empty">Select a commit to inspect its changes.</div>
          ) : !detailForSelection && detailLoading ? (
            <SkeletonRows count={10} height={14} />
          ) : detailForSelection ? (
            <>
              <div className="repo-git-commit-meta">
                <div className="repo-git-commit-meta-top">
                  <span className="repo-git-graph-hash font-mono">{detailForSelection.shortHash}</span>
                  {selectedCommit && isUnpushed(selectedCommit) && (
                    <span className="repo-git-ref-chip" data-tone="warning">
                      unpushed
                    </span>
                  )}
                  {detailForSelection.parents[0] && (
                    <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
                      parent {detailForSelection.parents[0].slice(0, 7)}
                    </span>
                  )}
                </div>
                <div className="repo-git-commit-subject">{detailForSelection.subject}</div>
                {detailForSelection.body ? (
                  <pre className="repo-git-commit-body">{detailForSelection.body}</pre>
                ) : null}
                <div className="repo-git-commit-byline">
                  <span>{detailForSelection.author}</span>
                  {detailForSelection.authorEmail ? (
                    <span style={{ color: "var(--text-subtle)" }}>
                      &lt;{detailForSelection.authorEmail}&gt;
                    </span>
                  ) : null}
                  <span style={{ color: "var(--text-subtle)" }}>
                    {detailForSelection.relativeDate}
                    {detailForSelection.date
                      ? ` · ${detailForSelection.date.slice(0, 19).replace("T", " ")}`
                      : ""}
                  </span>
                </div>
                {canResetStashAhead && (
                  <div className="repo-git-commit-meta-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={acting !== null}
                      title={`Stash ${detailForSelection.aheadCount} commit${
                        detailForSelection.aheadCount === 1 ? "" : "s"
                      } ahead, then reset HEAD to this commit`}
                      onClick={() => void resetStashAhead()}
                    >
                      {acting === "reset-stash" ? (
                        <RefreshCw size={11} className="animate-spin" />
                      ) : (
                        <Layers size={11} />
                      )}
                      Stash ahead & reset
                      <span className="repo-git-commit-meta-actions-count">
                        {detailForSelection.aheadCount}
                      </span>
                    </button>
                  </div>
                )}
                {showDivergedNote && (
                  <div className="repo-git-commit-meta-note">
                    Not an ancestor of HEAD — stash-ahead reset is unavailable for diverged history.
                  </div>
                )}
              </div>
              <div className="repo-git-history-detail-grid">
                <div className="repo-git-commit-files">
                  <div className="repo-git-section-label">
                    Files
                    <span className="repo-git-section-label-end">{detailForSelection.files.length}</span>
                  </div>
                  {detailForSelection.files.length === 0 ? (
                    <div className="repo-git-empty-sm">No file changes in this commit.</div>
                  ) : (
                    detailForSelection.files.map((f) => (
                      <button
                        key={f.path}
                        type="button"
                        className="repo-git-commit-file"
                        data-active={activeFile === f.path || undefined}
                        onClick={() => setSelectedFile(f.path)}
                      >
                        <span className="repo-git-file-status">{f.status}</span>
                        <span className="font-mono truncate" title={f.path}>
                          {f.path}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div className="repo-git-diff-pane">
                  <div className="repo-git-diff-head">
                    {activeFile ? (
                      <span className="font-mono truncate" title={activeFile}>
                        {activeFile}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-subtle)" }}>Select a file</span>
                    )}
                  </div>
                  <div className="repo-git-diff-body repo-git-diff-body-static">
                    {detailLoading ? (
                      <SkeletonRows count={8} height={14} />
                    ) : (
                      <GitDiffView
                        lines={detailForSelection.lines}
                        emptyMessage="No textual diff for this file (binary or empty)."
                      />
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="repo-git-empty">Could not load commit detail.</div>
          )}
        </div>
      </div>
    </div>
  );
}
