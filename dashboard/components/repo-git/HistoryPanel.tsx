"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GitMerge, Layers, RefreshCw, RotateCcw, Search, Upload } from "lucide-react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useToast } from "@/lib/hooks/use-toast";
import type { DiffLine } from "@/lib/repos/git-parsers";
import type { GraphLaneCommit } from "@/lib/repos/git-graph";
import { CommitGraph } from "./CommitGraph";
import { DiffMaximizeModal } from "./DiffMaximizeModal";
import { DiffToolbar, DIFF_CONTEXT_LINES, type DiffContextMode } from "./DiffToolbar";
import { GitDiffView } from "./GitDiffView";
import { RepoFileOpenMenu } from "./RepoFileOpenMenu";
import { RepoSplit } from "./SplitResize";
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
  context?: number;
  isHead?: boolean;
  isAncestorOfHead?: boolean;
  aheadCount?: number;
}

interface BranchRelation {
  currentBranch: string;
  mainBranch: string | null;
  mainShort: string | null;
  aheadMain: number;
  behindMain: number;
  onMain: boolean;
  mergedIntoMain: boolean;
}

interface LogPayload {
  commits: GraphLaneCommit[];
  currentBranch?: string;
  mainBranch?: string | null;
  mainShort?: string | null;
  aheadMain?: number;
  behindMain?: number;
  onMain?: boolean;
  mergedIntoMain?: boolean;
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
  const [relation, setRelation] = useState<BranchRelation | null>(null);
  const [detail, setDetail] = useState<CommitShowPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [contextMode, setContextMode] = useState<DiffContextMode>("default");
  const [historyListFr, setHistoryListFr] = useState(0.46);
  const [filesFr, setFilesFr] = useState(0.34);
  const [diffMaximized, setDiffMaximized] = useState(false);
  const closeMaximized = useCallback(() => setDiffMaximized(false), []);
  const stackHistory = useMediaQuery("(max-width: 900px)");
  const stackDetail = useMediaQuery("(max-width: 720px)");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [logJson, branchJson] = await Promise.all([
        fetchGitJson<LogPayload>(repoApi(repoName, "/git/log?limit=80")),
        fetchGitJson<BranchesPayload>(repoApi(repoName, "/branches")).catch(() => null),
      ]);
      setCommits(logJson.commits ?? []);
      setSelected((prev) => prev ?? logJson.commits?.[0]?.hash ?? null);
      setRelation({
        currentBranch: logJson.currentBranch ?? branchJson?.currentBranch ?? "HEAD",
        mainBranch: logJson.mainBranch ?? branchJson?.mainBranch ?? null,
        mainShort:
          logJson.mainShort ??
          (branchJson?.mainBranch ? branchJson.mainBranch.replace(/^origin\//, "") : null),
        aheadMain: logJson.aheadMain ?? branchJson?.aheadMain ?? 0,
        behindMain: logJson.behindMain ?? branchJson?.behindMain ?? 0,
        onMain: logJson.onMain ?? false,
        mergedIntoMain: logJson.mergedIntoMain ?? false,
      });

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
        if (contextMode === "full") {
          params.set("full", "1");
        } else {
          params.set("context", String(DIFF_CONTEXT_LINES[contextMode]));
        }
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
  }, [repoName, selected, selectedFile, contextMode, toast]);

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
      {relation?.mainBranch ? <BranchRelationStrip relation={relation} /> : null}
      <RepoSplit
        className="repo-git-history-split"
        primaryFr={historyListFr}
        onPrimaryFrChange={setHistoryListFr}
        minPrimaryFr={0.28}
        maxPrimaryFr={0.62}
        stacked={stackHistory}
        handleLabel="Resize history list and detail"
        primary={
          <div className="repo-git-history-list">
            <CommitGraph
              commits={filtered}
              selectedHash={selected}
              onSelect={(hash) => {
                setSelectedFile(null);
                setSelected(hash);
              }}
              unpushedHashes={unpushedHashes}
              mainRefNames={
                relation?.mainShort
                  ? [relation.mainShort, `origin/${relation.mainShort}`, relation.mainBranch].filter(
                      (ref): ref is string => Boolean(ref),
                    )
                  : []
              }
            />
          </div>
        }
        secondary={
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
                      <span className="text-xs text-text-subtle">
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
                      <span className="text-text-subtle">
                        &lt;{detailForSelection.authorEmail}&gt;
                      </span>
                    ) : null}
                    <span className="text-text-subtle">
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
                <RepoSplit
                  className="repo-git-history-detail-grid"
                  primaryFr={filesFr}
                  onPrimaryFrChange={setFilesFr}
                  minPrimaryFr={0.18}
                  maxPrimaryFr={0.55}
                  stacked={stackDetail}
                  handleLabel="Resize file list and diff"
                  primary={
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
                  }
                  secondary={
                    <div className="repo-git-diff-pane">
                      <div className="repo-git-diff-head">
                        {activeFile ? (
                          <span className="font-mono truncate" title={activeFile}>
                            {activeFile}
                          </span>
                        ) : (
                          <span className="text-text-subtle">Select a file</span>
                        )}
                        <DiffToolbar
                          mode={contextMode}
                          onModeChange={setContextMode}
                          onMaximize={() => setDiffMaximized(true)}
                          maximizeDisabled={!activeFile}
                          openSlot={
                            activeFile && detailForSelection ? (
                              <RepoFileOpenMenu
                                repoName={repoName}
                                filePath={activeFile}
                                commit={detailForSelection.hash}
                                disabled={detailLoading}
                              />
                            ) : null
                          }
                        />
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
                  }
                />
              </>
            ) : (
              <div className="repo-git-empty">Could not load commit detail.</div>
            )}
          </div>
        }
      />
      <DiffMaximizeModal
        maximized={diffMaximized}
        canOpen={Boolean(activeFile)}
        onClose={closeMaximized}
        title={activeFile ?? "Diff"}
        description={
          detailForSelection
            ? `${detailForSelection.shortHash} · ${detailForSelection.subject}`
            : undefined
        }
        mode={contextMode}
        onModeChange={setContextMode}
        openSlot={
          activeFile && detailForSelection ? (
            <RepoFileOpenMenu
              repoName={repoName}
              filePath={activeFile}
              commit={detailForSelection.hash}
              disabled={detailLoading}
            />
          ) : null
        }
      >
        {detailLoading ? (
          <SkeletonRows count={12} height={14} />
        ) : detailForSelection ? (
          <GitDiffView
            lines={detailForSelection.lines}
            emptyMessage="No textual diff for this file (binary or empty)."
          />
        ) : null}
      </DiffMaximizeModal>
    </div>
  );
}

function BranchRelationStrip({ relation }: { relation: BranchRelation }) {
  const main = relation.mainShort ?? "main";
  const ahead = relation.aheadMain;
  const behind = relation.behindMain;

  let status: string;
  let tone: "ok" | "ahead" | "behind" | "diverged" | "merged";
  if (relation.onMain) {
    status = `On ${main}`;
    tone = "ok";
  } else if (relation.mergedIntoMain) {
    status =
      behind > 0
        ? `Merged into ${main} · ${behind} behind tip`
        : `Merged into ${main}`;
    tone = "merged";
  } else if (ahead > 0 && behind > 0) {
    status = `Diverged from ${main} · ↑${ahead} · ↓${behind}`;
    tone = "diverged";
  } else if (ahead > 0) {
    status = `↑${ahead} ahead of ${main}`;
    tone = "ahead";
  } else if (behind > 0) {
    status = `↓${behind} behind ${main}`;
    tone = "behind";
  } else {
    status = `Aligned with ${main}`;
    tone = "ok";
  }

  const relationTitle =
    "Ahead/behind vs default main (origin/" +
    main +
    "). Unpushed / Push counts are vs your upstream tracking branch — they can differ.";

  return (
    <div className="repo-git-branch-relation" data-tone={tone} title={relationTitle}>
      <div className="repo-git-branch-relation-viz" aria-hidden>
        <svg width="72" height="28" viewBox="0 0 72 28">
          {/* main lane */}
          <line x1="8" y1="8" x2="64" y2="8" stroke="var(--success)" strokeWidth="1.5" opacity="0.7" />
          <circle cx="64" cy="8" r="3.5" fill="var(--success)" />
          {/* branch lane */}
          {!relation.onMain && (
            <>
              <path
                d={
                  ahead > 0 || behind > 0 || relation.mergedIntoMain
                    ? "M 28 8 C 28 18, 36 20, 44 20"
                    : "M 28 8 L 44 20"
                }
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.5"
                opacity="0.85"
              />
              <line
                x1="44"
                y1="20"
                x2={relation.mergedIntoMain ? "44" : "64"}
                y2="20"
                stroke="var(--accent)"
                strokeWidth="1.5"
                opacity="0.85"
              />
              {!relation.mergedIntoMain && (
                <circle cx="64" cy="20" r="3.5" fill="var(--accent)" />
              )}
              {relation.mergedIntoMain && (
                <circle cx="44" cy="20" r="3" fill="var(--accent)" opacity="0.7" />
              )}
            </>
          )}
          {relation.onMain && <circle cx="40" cy="8" r="3" fill="var(--accent)" />}
        </svg>
      </div>
      <div className="repo-git-branch-relation-copy">
        <div className="repo-git-branch-relation-title">
          <GitMerge size={11} aria-hidden />
          <span className="font-mono">{relation.currentBranch}</span>
          <span className="text-text-subtle">vs</span>
          <span className="font-mono">{main}</span>
        </div>
        <div className="repo-git-branch-relation-status">{status}</div>
      </div>
      {!relation.onMain && (ahead > 0 || behind > 0) && (
        <div className="repo-git-branch-relation-counts" aria-label="Ahead and behind main">
          {ahead > 0 && <span data-dir="ahead">↑{ahead}</span>}
          {behind > 0 && <span data-dir="behind">↓{behind}</span>}
        </div>
      )}
    </div>
  );
}
