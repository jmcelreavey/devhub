"use client";

import { useCallback, useState } from "react";
import { ExternalLink, FolderTree, RefreshCw, Trash2 } from "lucide-react";
import { EmptyState, SkeletonRows } from "@/components";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import type { WorktreeCleanupResult, WorktreeCleanupRow } from "@/lib/repos/worktree-cleanup";

export const WORKTREE_CLEANUP_KEY = "/api/repos/worktree-cleanup";

/**
 * A cross-repo git and GitHub scan, so it does not belong on the live poll the
 * rest of this page uses. Revalidate on focus and on demand instead.
 */
export const WORKTREE_CLEANUP_OPTS = { refreshInterval: 0 } as const;

function reasonLabel(row: WorktreeCleanupRow): string {
  if (row.reason === "pr-merged") return `#${row.pr?.number} merged`;
  if (row.reason === "run-finished") return `agent run ${row.run?.state}`;
  return "folder missing";
}

/**
 * Worktrees whose work is finished, with the evidence that says so.
 *
 * Lives beside the PR tabs because the evidence usually *is* a merged PR — the
 * moment you notice a branch is done is the moment the leftover checkout is
 * worth deleting.
 */
export function WorktreeCleanupPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, isLoading, mutate } = useLive<WorktreeCleanupResult>(
    WORKTREE_CLEANUP_KEY,
    WORKTREE_CLEANUP_OPTS,
  );
  const [acting, setActing] = useState<string | null>(null);

  const remove = useCallback(
    async (row: WorktreeCleanupRow) => {
      const ok = await confirm({
        title: `Remove the worktree at ${row.path}?`,
        message: `The branch ${row.branch ?? "(detached)"} and its commits stay — only this checkout folder is removed.`,
        confirmLabel: "Remove",
        variant: "danger",
      });
      if (!ok) return;

      const post = async (force?: boolean) => {
        const res = await fetch(WORKTREE_CLEANUP_KEY, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo: row.repo, path: row.path, ...(force ? { force: true } : {}) }),
        });
        return { status: res.status, body: (await res.json()) as { error?: string; code?: string } };
      };

      setActing(row.path);
      try {
        let result = await post();
        if (result.body.code === "worktree_dirty") {
          // Git refuses a dirty tree by default, which is right. Naming what is
          // about to be discarded beats retrying blind.
          const forceOk = await confirm({
            title: "This worktree has uncommitted changes",
            message: `${row.path} has modified or untracked files. Removing it discards them permanently.`,
            confirmLabel: "Discard and remove",
            variant: "danger",
          });
          if (!forceOk) return;
          result = await post(true);
        }
        if (result.status >= 400) throw new Error(result.body.error ?? "Could not remove the worktree");
        toast.success("Worktree removed");
        await mutate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not remove the worktree");
      } finally {
        setActing(null);
      }
    },
    [confirm, mutate, toast],
  );

  if (isLoading && !data) return <SkeletonRows count={3} height={40} variant="list" />;
  if (error) return <EmptyState title="Could not scan worktrees" />;

  const rows = data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing safe to remove"
        subtitle={
          data?.kept
            ? `${data.kept} other worktree${data.kept === 1 ? " has" : "s have"} no merged PR or finished run to go on — check those by hand.`
            : "No leftover worktrees in any local repo."
        }
      />
    );
  }

  return (
    <div className="space-y-2">
      {data?.failedRepos.length ? (
        <div className="text-xs" style={{ color: "var(--text-subtle)" }}>
          Could not read {data.failedRepos.join(", ")} — rows for those repos may be missing.
        </div>
      ) : null}

      {rows.map((row) => (
        <div
          key={row.path}
          className="flex items-start gap-2 rounded p-2"
          style={{ border: "1px solid var(--border-muted)" }}
        >
          <FolderTree size={12} className="mt-1 shrink-0 text-text-subtle" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{row.repo}</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {row.branch ?? "(detached)"}
              </span>
              <span className="badge badge-muted" style={{ fontSize: 11 }}>
                {reasonLabel(row)}
              </span>
              {row.pr?.url && (
                <a
                  href={row.pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs"
                  style={{ color: "var(--text-subtle)" }}
                  title={row.pr.title}
                >
                  <ExternalLink size={10} aria-hidden /> PR
                </a>
              )}
            </div>
            <div className="truncate text-xs" style={{ color: "var(--text-subtle)" }} title={row.path}>
              {row.path}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost repo-git-icon-btn"
            data-danger
            aria-label={`Remove worktree ${row.path}`}
            disabled={acting !== null}
            onClick={() => void remove(row)}
          >
            {acting === row.path ? (
              <RefreshCw size={10} className="animate-spin" aria-hidden />
            ) : (
              <Trash2 size={10} aria-hidden />
            )}
          </button>
        </div>
      ))}

      {/* Say what was left out, so the list does not read as "all of them". */}
      {data?.kept ? (
        <div className="text-xs" style={{ color: "var(--text-subtle)" }}>
          {data.kept} other worktree{data.kept === 1 ? " has" : "s have"} no merged PR or finished
          run to go on — not listed, check those by hand in the repo&apos;s Git tab.
        </div>
      ) : null}
    </div>
  );
}
