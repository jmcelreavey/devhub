"use client";

import Link from "next/link";
import { FolderTree } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import {
  WORKTREE_CLEANUP_KEY,
  WORKTREE_CLEANUP_OPTS,
} from "@/components/prs/WorktreeCleanupPanel";
import type { WorktreeCleanupResult } from "@/lib/repos/worktree-cleanup";

/**
 * A one-line count of finished worktrees, linking to the tab that removes them.
 *
 * Not dismissible: unlike a drift nudge there is nothing to decide, and the row
 * disappears the moment the folders are gone. Deliberately just a count — the
 * evidence and the buttons live on the Worktrees tab rather than being
 * duplicated here.
 */
export function WorktreeCleanupNudge() {
  const { data } = useLive<WorktreeCleanupResult>(WORKTREE_CLEANUP_KEY, WORKTREE_CLEANUP_OPTS);
  const count = data?.rows.length ?? 0;
  if (count === 0) return null;

  const repos = new Set(data?.rows.map((row) => row.repo)).size;

  return (
    <section
      className="mb-3 rounded-lg border border-border bg-bg-elevated px-3 py-2.5"
      aria-label="Worktree cleanup"
    >
      <div className="flex items-center gap-1.5 text-xs">
        <FolderTree size={13} className="shrink-0 text-text-subtle" aria-hidden />
        <span className="text-text">
          {count} finished worktree{count === 1 ? "" : "s"}
        </span>
        <span className="text-text-muted">
          across {repos} repo{repos === 1 ? "" : "s"} — merged PRs or stopped agent runs
        </span>
        <Link
          href="/prs?tab=cleanup"
          className="ml-auto text-accent underline-offset-2 hover:underline"
        >
          Review and remove
        </Link>
      </div>
    </section>
  );
}
