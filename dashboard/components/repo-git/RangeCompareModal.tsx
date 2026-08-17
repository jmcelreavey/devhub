"use client";

import { useEffect, useState } from "react";
import { GitCompare, Share2 } from "lucide-react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { ModalShell } from "@/components/shell/ModalShell";
import { useStoredFraction } from "@/lib/hooks/use-stored-state";
import { useToast } from "@/lib/hooks/use-toast";
import type { DiffLine } from "@/lib/repos/git-parsers";
import { DiffToolbar, DIFF_CONTEXT_LINES, type DiffContextMode } from "./DiffToolbar";
import { GitDiffView } from "./GitDiffView";
import { RepoSplit } from "./SplitResize";
import { fetchGitJson, repoApi } from "./shared";
import { shareGitRangePatch } from "./shareGitPatch";

interface RangePayload {
  base: string;
  head: string;
  ahead: number;
  behind: number;
  files: { path: string; status: string }[];
  path: string | null;
  lines: DiffLine[];
}

/**
 * "What does this branch change vs the trunk" — the review-shaped question.
 *
 * Split out of HistoryPanel rather than folded in: History answers "what did
 * this one commit do", and bolting a second mode onto a 700-line component
 * would have meant threading a mode flag through every piece of its state.
 */
export function RangeCompareModal({
  repoName,
  open,
  onClose,
  currentBranch,
  base,
  head,
  title = "Compare with default branch",
}: {
  repoName: string;
  open: boolean;
  onClose: () => void;
  currentBranch?: string;
  /** Left side of the range. Defaults to the repo's trunk, server-side. */
  base?: string;
  /** Right side of the range. Defaults to HEAD, server-side. */
  head?: string;
  title?: string;
}) {
  const toast = useToast();
  const [data, setData] = useState<RangePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [contextMode, setContextMode] = useState<DiffContextMode>("default");
  const [listFr, setListFr] = useStoredFraction("devhub:repo-git:range-list-fr", 0.32);
  const [sharing, setSharing] = useState(false);

  // The caller mounts this only while open, so each comparison starts with
  // fresh state — no reset-on-close effect needed.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Deferred like RunLogModal / TerminalTranscriptModal: flipping the spinner
    // on synchronously inside an effect is the cascading-render pattern lint
    // rejects, and a same-tick response wouldn't flash it anyway.
    const boot = window.setTimeout(() => {
      if (!cancelled) setLoading(true);
    }, 0);
    void (async () => {
      try {
        const qs = new URLSearchParams();
        if (base) qs.set("base", base);
        if (head) qs.set("head", head);
        if (selectedFile) qs.set("path", selectedFile);
        if (contextMode === "full") qs.set("full", "1");
        else qs.set("context", String(DIFF_CONTEXT_LINES[contextMode]));
        const json = await fetchGitJson<RangePayload>(repoApi(repoName, `/git/range?${qs}`));
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Compare failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(boot);
    };
  }, [open, selectedFile, contextMode, repoName, base, head, toast]);

  const summary = data
    ? `${data.head} vs ${data.base} · ${data.ahead} ahead · ${data.behind} behind`
    : currentBranch
      ? `${currentBranch} vs default branch`
      : undefined;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={title}
      description={summary}
      maxWidth="max-w-[min(96vw,1200px)]"
      align="top"
    >
      <div className="repo-git-diff-modal">
        {loading && !data ? (
          <SkeletonRows count={10} height={14} />
        ) : !data ? (
          <div className="repo-git-empty">Could not compare this branch.</div>
        ) : data.files.length === 0 ? (
          <div className="repo-git-empty">
            No differences from {data.base} — this branch has nothing to review.
          </div>
        ) : (
          <RepoSplit
            className="repo-git-history-detail-grid"
            primaryFr={listFr}
            onPrimaryFrChange={setListFr}
            minPrimaryFr={0.18}
            maxPrimaryFr={0.55}
            handleLabel="Resize file list and diff"
            primary={
              <div className="repo-git-commit-files">
                <div className="repo-git-section-label">
                  Files
                  <span className="repo-git-section-label-end">{data.files.length}</span>
                </div>
                {data.files.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    className="repo-git-commit-file"
                    data-active={selectedFile === f.path || undefined}
                    onClick={() => setSelectedFile(f.path)}
                  >
                    <span className="repo-git-file-status">{f.status}</span>
                    <span className="font-mono truncate" title={f.path}>
                      {f.path}
                    </span>
                  </button>
                ))}
              </div>
            }
            secondary={
              <div className="repo-git-diff-pane">
                <div className="repo-git-diff-head">
                  {selectedFile ? (
                    <span className="font-mono truncate" title={selectedFile}>
                      {selectedFile}
                    </span>
                  ) : (
                    <span className="text-text-subtle">Whole range — select a file to narrow</span>
                  )}
                  <DiffToolbar mode={contextMode} onModeChange={setContextMode} />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={sharing}
                    title="Share this diff for 24h as a one-time PrivateBin link"
                    onClick={() => {
                      setSharing(true);
                      void shareGitRangePatch(repoName, data.base, data.head).then(
                        (msg) => toast.success(msg),
                        (err: unknown) => toast.error(err instanceof Error ? err.message : "Share failed"),
                      ).finally(() => setSharing(false));
                    }}
                  >
                    <Share2 size={11} aria-hidden />
                    {sharing ? "Sharing…" : "Share 24h"}
                  </button>
                </div>
                <div className="repo-git-diff-body repo-git-diff-body-static">
                  {loading ? (
                    <SkeletonRows count={8} height={14} />
                  ) : (
                    <GitDiffView
                      lines={data.lines}
                      emptyMessage="No textual diff (binary or empty)."
                    />
                  )}
                </div>
              </div>
            }
          />
        )}
      </div>
    </ModalShell>
  );
}

/** Toolbar entry point for {@link RangeCompareModal}. */
export function RangeCompareButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={onClick}
      title="Diff this whole branch against the default branch"
    >
      <GitCompare size={11} aria-hidden /> Compare
    </button>
  );
}
