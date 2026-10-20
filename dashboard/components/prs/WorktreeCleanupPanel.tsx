"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type MouseEvent } from "react";
import { ExternalLink, FolderTree, RefreshCw, Trash2 } from "lucide-react";
import { EmptyState, SkeletonRows } from "@/components";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { agentsHref } from "@/lib/agent-handoff";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import type { BulkWorktreeResult, WorktreeCleanupResult, WorktreeCleanupRow } from "@/lib/repos/worktree-cleanup";
import styles from "./WorktreeCleanupPanel.module.css";

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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a — has uncommitted changes; b — …", capped so the confirm stays readable. */
export function describeSkipped(skipped: BulkWorktreeResult["skipped"], max = 3): string {
  const lines = skipped.slice(0, max).map((s) => `${s.path.split("/").filter(Boolean).pop() ?? s.path}: ${s.reason}`);
  if (skipped.length > max) lines.push(`and ${skipped.length - max} more`);
  return lines.join("; ");
}

async function postBulk(rows: readonly WorktreeCleanupRow[], dryRun: boolean): Promise<BulkWorktreeResult> {
  const res = await fetch(WORKTREE_CLEANUP_KEY, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: rows.map((row) => ({ repo: row.repo, path: row.path })), ...(dryRun ? { dryRun: true } : {}) }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<BulkWorktreeResult> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Could not remove the worktrees");
  return { removed: body.removed ?? [], skipped: body.skipped ?? [] };
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<number | null>(null);
  const rows = data?.rows ?? [];

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
        setSelected((prev) => { const next = new Set(prev); next.delete(row.path); return next; });
        await mutate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not remove the worktree");
      } finally {
        setActing(null);
      }
    },
    [confirm, mutate, toast],
  );

  /**
   * Delete several at once. Never forced: a dry run first finds the ones with
   * uncommitted changes or a run still going, the confirm names them, and the
   * server rechecks each one before removing anything.
   */
  const removeMany = useCallback(
    async (targets: readonly WorktreeCleanupRow[]) => {
      if (!targets.length) return;
      setActing("bulk");
      try {
        const preview = await postBulk(targets, true);
        if (!preview.removed.length) {
          toast.info(`Nothing deleted. ${describeSkipped(preview.skipped)}.`);
          return;
        }
        const ok = await confirm({
          title: `Delete ${plural(preview.removed.length, "worktree")}?`,
          message: [
            "Branches and commits stay — only the checkout folders go.",
            preview.skipped.length ? `${plural(preview.skipped.length, "worktree")} will be skipped (${describeSkipped(preview.skipped)}).` : "",
          ].filter(Boolean).join(" "),
          confirmLabel: `Delete ${preview.removed.length}`,
          variant: "danger",
        });
        if (!ok) return;
        const result = await postBulk(targets, false);
        if (result.removed.length) toast.success(`Deleted ${plural(result.removed.length, "worktree")}`);
        if (result.skipped.length) toast.info(`Skipped ${result.skipped.length}: ${describeSkipped(result.skipped)}.`);
        setSelected(new Set());
        anchor.current = null;
        await mutate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not remove the worktrees");
      } finally {
        setActing(null);
      }
    },
    [confirm, mutate, toast],
  );

  /** Click toggles one row; shift-click sets the whole range from the last click to the same state. */
  const toggle = (index: number, event: MouseEvent<HTMLInputElement>) => {
    const path = rows[index].path;
    const on = !selected.has(path);
    const from = event.shiftKey && anchor.current !== null ? Math.min(anchor.current, index) : index;
    const to = event.shiftKey && anchor.current !== null ? Math.max(anchor.current, index) : index;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of rows.slice(from, to + 1)) {
        if (on) next.add(row.path);
        else next.delete(row.path);
      }
      return next;
    });
    anchor.current = index;
  };

  if (isLoading && !data) return <SkeletonRows count={3} height={40} variant="list" />;
  if (error) return <EmptyState title="Could not scan worktrees" />;

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

  const chosen = rows.filter((row) => selected.has(row.path));
  const busy = acting !== null;

  return (
    <div className="space-y-2">
      {data?.failedRepos.length ? (
        <div className="text-xs" style={{ color: "var(--text-subtle)" }}>
          Could not read {data.failedRepos.join(", ")} — rows for those repos may be missing.
        </div>
      ) : null}

      {chosen.length ? (
        <div className={styles.bar} role="toolbar" aria-label="Selected worktrees">
          <span>{chosen.length} selected</span>
          <span className={styles.barActions}>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void removeMany(chosen)}>
              Delete
            </button>
            <span className={styles.sep} aria-hidden>·</span>
            <button type="button" className="btn btn-ghost" onClick={() => { setSelected(new Set()); anchor.current = null; }}>
              Clear
            </button>
          </span>
        </div>
      ) : (
        <div className={styles.bar}>
          <span>{plural(rows.length, "finished worktree")}</span>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void removeMany(rows)}>
            {acting === "bulk" ? <RefreshCw size={11} className="animate-spin" aria-hidden /> : null}
            Delete all
          </button>
        </div>
      )}

      <div className={`${styles.list} space-y-2`} data-selecting={chosen.length ? "" : undefined}>
        {rows.map((row, index) => {
          const runHref = row.run?.id ? agentsHref(undefined, row.run.id) : null;
          return (
            <div key={row.path} className={styles.row} data-selected={selected.has(row.path) ? "" : undefined}>
              <input
                type="checkbox"
                className={styles.check}
                checked={selected.has(row.path)}
                aria-label={`Select worktree ${row.path}`}
                onClick={(event) => toggle(index, event)}
                onChange={() => undefined}
              />
              <FolderTree size={12} className={styles.icon} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{row.repo}</span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {row.branch ?? "(detached)"}
                  </span>
                  {runHref ? (
                    <Link href={runHref} className={`badge badge-muted ${styles.pill}`} title="Open this agent run">
                      {reasonLabel(row)}
                    </Link>
                  ) : row.pr?.url ? (
                    // The pill is the PR link: one target instead of a dead pill beside a "PR" link.
                    <a
                      href={row.pr.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`badge badge-muted inline-flex items-center gap-1 ${styles.pill}`}
                      title={row.pr.title ? `Open on GitHub: ${row.pr.title}` : "Open on GitHub"}
                    >
                      {reasonLabel(row)}
                      <ExternalLink size={9} aria-hidden />
                    </a>
                  ) : (
                    <span className={`badge badge-muted ${styles.pill}`}>{reasonLabel(row)}</span>
                  )}
                </div>
                <div className="truncate text-xs" style={{ color: "var(--text-subtle)" }} title={row.path}>
                  {row.path}
                </div>
              </div>
              <button
                type="button"
                className={styles.delete}
                data-busy={acting === row.path ? "" : undefined}
                aria-label={`Remove worktree ${row.path}`}
                title="Remove worktree"
                disabled={busy}
                onClick={() => void remove(row)}
              >
                {acting === row.path ? (
                  <RefreshCw size={13} className="animate-spin" aria-hidden />
                ) : (
                  <Trash2 size={13} aria-hidden />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Say what was left out, so the list does not read as "all of them". */}
      {data?.kept ? (
        <div className="text-xs" style={{ color: "var(--text-subtle)" }}>
          {data.kept} other worktree{data.kept === 1 ? " has" : "s have"} no merged PR or finished
          run to go on — not listed. Check those by hand from{" "}
          <Link href="/repos" className="underline underline-offset-2 hover:text-accent">Repos</Link>.
        </div>
      ) : null}
    </div>
  );
}
