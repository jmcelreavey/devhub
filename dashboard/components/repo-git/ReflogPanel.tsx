"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GitBranch, History, RefreshCw, Search, Undo2 } from "lucide-react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { usePrompt } from "@/components/shell/ConfirmDialog";
import { useToast } from "@/lib/hooks/use-toast";
import { isSafeBranchName } from "@/app/api/repos/[name]/branches/parsers";
import type { ReflogEntry } from "@/lib/repos/reflog-parsers";
import { fetchGitJson, repoApi } from "./shared";

interface ReflogPayload {
  entries: ReflogEntry[];
  unreachableCount: number;
  reachabilityKnown: boolean;
}

/**
 * Where HEAD has been, and what is only still reachable from here.
 *
 * DevHub writes `devhub/backup-*` refs before its own destructive operations,
 * but a reset run from the integrated terminal — or a rebase that went further
 * than intended — leaves nothing behind. This is the surface where those
 * commits can still be found, for as long as git keeps them.
 */
export function ReflogPanel({
  repoName,
  onMutate,
  onOpenCommit,
}: {
  repoName: string;
  onMutate: () => void;
  /** Hand a commit to the History tab, which already knows how to show one. */
  onOpenCommit?: (hash: string) => void;
}) {
  const toast = useToast();
  const prompt = usePrompt();
  const [data, setData] = useState<ReflogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lostOnly, setLostOnly] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchGitJson<ReflogPayload>(repoApi(repoName, "/git/reflog?limit=200")));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reflog failed");
    } finally {
      setLoading(false);
    }
  }, [repoName, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the reflog on mount / repo change
    void refresh();
  }, [refresh]);

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.entries ?? []).filter((e) => {
      if (lostOnly && !e.unreachable) return false;
      if (!q) return true;
      return (
        e.action.toLowerCase().includes(q) ||
        e.detail.toLowerCase().includes(q) ||
        e.shortHash.toLowerCase().includes(q) ||
        e.selector.toLowerCase().includes(q)
      );
    });
  }, [data?.entries, query, lostOnly]);

  /**
   * Recovery is branch-from-here, not reset.
   *
   * A reset to rescue a lost commit would move the current branch and could
   * lose whatever is on it now — trading one accident for another. Creating a
   * branch is additive: nothing that exists is touched, and the commit stops
   * depending on the reflog surviving gc.
   */
  const rescue = useCallback(
    async (entry: ReflogEntry) => {
      const name = await prompt({
        title: "Recover to a new branch",
        message: `Create a branch at ${entry.shortHash} (${entry.action}${entry.detail ? `: ${entry.detail}` : ""}). Nothing on your current branch changes.`,
        input: { placeholder: "recovered/my-work", defaultValue: `recovered/${entry.shortHash}` },
        confirmLabel: "Create branch",
      });
      if (!name) return;
      if (!isSafeBranchName(name)) {
        toast.error("That is not a valid branch name.");
        return;
      }
      setActing(entry.selector);
      try {
        const res = await fetch(repoApi(repoName, "/git/commit-action"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "branch-from-commit", commit: entry.hash, name }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Could not create the branch");
        toast.success(`Created ${name} at ${entry.shortHash}`);
        onMutate();
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Recovery failed");
      } finally {
        setActing(null);
      }
    },
    [prompt, repoName, toast, onMutate, refresh],
  );

  if (loading && !data) return <SkeletonRows count={8} height={32} />;

  const lost = data?.unreachableCount ?? 0;

  return (
    <div className="repo-git-history">
      <div className="repo-git-changes-toolbar">
        <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
          <RefreshCw size={11} className={loading ? "animate-spin" : undefined} /> Refresh
        </button>
        {lost > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            data-active={lostOnly || undefined}
            aria-pressed={lostOnly}
            onClick={() => setLostOnly((v) => !v)}
            title="Show only commits no branch or tag points at any more"
          >
            <Undo2 size={11} />
            {lostOnly ? "Unreachable only" : `Unreachable (${lost})`}
          </button>
        )}
        <div className="repo-git-spacer" />
        <label className="repo-git-filter repo-git-filter-search">
          <Search size={12} aria-hidden />
          <span className="sr-only">Filter reflog</span>
          <input
            className="input repo-git-filter-input"
            type="search"
            placeholder="Filter by action or hash…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter reflog"
          />
        </label>
      </div>
      <div className="repo-git-branch-hint">
        {data?.reachabilityKnown === false
          ? "Every position HEAD has held. Could not determine which commits are still reachable."
          : "Every position HEAD has held. Unreachable commits exist only here, until git prunes them."}
      </div>
      <div className="repo-git-branch-list">
        {entries.length === 0 && (
          <div className="repo-git-empty-sm">
            {query.trim() || lostOnly ? "Nothing matches that filter." : "The reflog is empty."}
          </div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.selector}
            className="repo-git-branch-row"
            data-unreachable={entry.unreachable || undefined}
          >
            <button
              type="button"
              className="repo-git-branch-main"
              onClick={() => onOpenCommit?.(entry.hash)}
              title={
                entry.unreachable
                  ? `${entry.hash} — not reachable from any ref`
                  : `${entry.hash} — open in History`
              }
            >
              <History size={12} className="text-text-subtle" />
              <span className="font-mono text-xs">{entry.shortHash}</span>
              <span style={{ fontWeight: 500 }}>{entry.action}</span>
              <span className="truncate text-text-subtle">{entry.detail}</span>
              {entry.unreachable && (
                <span className="repo-git-ref-chip" data-tone="warning">
                  unreachable
                </span>
              )}
              <span className="repo-git-graph-date">{entry.relativeDate}</span>
            </button>
            <button
              type="button"
              className="btn btn-ghost repo-git-icon-btn"
              aria-label={`Recover ${entry.shortHash} to a new branch`}
              title={`Recover ${entry.shortHash} to a new branch`}
              disabled={acting !== null}
              onClick={() => void rescue(entry)}
            >
              {acting === entry.selector ? (
                <RefreshCw size={10} className="animate-spin" />
              ) : (
                <GitBranch size={10} />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
