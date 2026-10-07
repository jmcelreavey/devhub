"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, LockOpen, Plus, RefreshCw, Trash2, Unlink } from "lucide-react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { FetchError } from "@/components/ui/FetchError";
import { useConfirm, usePrompt } from "@/components/shell/ConfirmDialog";
import { useToast } from "@/lib/hooks/use-toast";
import type { Worktree } from "@/lib/repos/worktree-parsers";
import { fetchGitJson, repoApi } from "./shared";
import { isWorktreeCleanupReady, type WorktreeInfo } from "@/lib/repos/worktree-info";
import { WorktreeSchedule } from "./WorktreeSchedule";
import { WorktreeDetails, WorktreeStatus, formatWorktreeSize } from "./WorktreeDetails";
import styles from "./WorktreesPanel.module.css";

interface WorktreesPayload {
  worktrees: WorktreeInfo[];
  repoRoot: string;
}

/**
 * Second checkouts of the same repository.
 *
 * The reason this exists here rather than as parity box-ticking: DevHub runs
 * agents across repos, and two agents on different branches in one working tree
 * fight over it — one `git checkout` and the other is reading half-swapped
 * files. A worktree per branch gives each its own directory backed by the same
 * history.
 */
export function WorktreesPanel({
  repoName,
  onMutate,
}: {
  repoName: string;
  onMutate: () => void;
}) {
  const toast = useToast();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const [data, setData] = useState<WorktreesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [includeIgnored, setIncludeIgnored] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await fetchGitJson<WorktreesPayload>(repoApi(repoName, "/worktrees?details=1")));
      setSelected([]);
      setIncludeIgnored(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not list worktrees");
    } finally {
      setLoading(false);
    }
  }, [repoName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load on mount / repo change
    void refresh();
  }, [refresh]);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<{ ok: boolean; code?: string; error?: string }> => {
      const res = await fetch(repoApi(repoName, "/git/worktrees"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string; code?: string };
      return { ok: res.ok, code: json.code, error: json.error };
    },
    [repoName],
  );

  const addWorktree = useCallback(async () => {
    const branch = await prompt({
      title: "New worktree",
      message:
        "Branch to check out. If it doesn't exist yet it will be created. The folder is placed next to the repository, so DevHub lists it as a repo of its own.",
      input: { placeholder: "feature/my-work" },
      confirmLabel: "Create worktree",
    });
    if (!branch?.trim()) return;
    const name = branch.trim();
    const existing = data?.worktrees.some((w) => w.branch === name);
    if (existing) {
      toast.error(`${name} is already checked out in another worktree.`);
      return;
    }
    setActing("add");
    try {
      // Try as an existing branch first; if git says there is no such ref,
      // create it. Cheaper than asking the user which they meant, and the two
      // failure modes are distinguishable.
      let result = await post({ action: "add", branch: name });
      if (!result.ok && /invalid reference|not a valid|unknown revision/i.test(result.error ?? "")) {
        result = await post({ action: "add", branch: name, createBranch: true });
      }
      if (!result.ok) throw new Error(result.error ?? "Could not create the worktree");
      toast.success(`Worktree ready for ${name}`);
      onMutate();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the worktree");
    } finally {
      setActing(null);
    }
  }, [prompt, data?.worktrees, post, toast, onMutate, refresh]);

  const removeWorktree = useCallback(async () => {
    const entries = (data?.worktrees ?? []).filter((tree) => selected.includes(tree.path) && isWorktreeCleanupReady(tree));
    if (!entries.length) return;
    if (!await confirm({
      title: `Remove ${entries.length} checkout${entries.length === 1 ? "" : "s"}?`,
      message: `The selected folders and their ignored local files will be deleted. Branches and commits remain. Stop any terminals and development servers using these folders before continuing. Estimated space: ${formatWorktreeSize(entries.reduce((sum, tree) => sum + (tree.details?.sizeBytes ?? 0), 0))}.`,
      confirmLabel: "Remove selected checkouts", variant: "danger",
    })) return;
    setActing("cleanup");
    try {
      const response = await fetch(repoApi(repoName, "/worktrees"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: entries.map(({ path, head }) => ({ path, head })), confirmed: true, includeIgnored, mergedOnly: true }),
      });
      const result = await response.json() as { removed: string[]; errors: { path: string; error: string }[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Could not remove checkouts");
      if (result.removed.length) toast.success(`Removed ${result.removed.length} checkout(s)`);
      for (const error of result.errors) toast.error(`${error.path}: ${error.error}`);
      onMutate();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove checkouts");
    } finally { setActing(null); }
  }, [data, selected, confirm, repoName, includeIgnored, toast, onMutate, refresh]);

  const simpleAction = useCallback(
    async (action: "prune" | "lock" | "unlock", tree?: Worktree) => {
      setActing(tree?.path ?? action);
      try {
        const result = await post({ action, path: tree?.path });
        if (!result.ok) throw new Error(result.error ?? `Could not ${action}`);
        toast.success(action === "prune" ? "Pruned stale worktrees" : `Worktree ${action}ed`);
        onMutate();
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Could not ${action}`);
      } finally {
        setActing(null);
      }
    },
    [post, toast, refresh, onMutate],
  );

  if (loading && !data) return <SkeletonRows count={3} height={88} />;

  const trees = (data?.worktrees ?? []).filter((tree) => !tree.isMain)
    .sort((left, right) => Number(isWorktreeCleanupReady(right)) - Number(isWorktreeCleanupReady(left)));
  const main = data?.worktrees.find((tree) => tree.isMain);
  const merged = trees.filter(isWorktreeCleanupReady);
  const stale = trees.filter((tree) => tree.prunable);
  const chosen = trees.filter((tree) => selected.includes(tree.path));
  const selectedHasIgnored = chosen.some((tree) => tree.details?.ignoredPaths.length);
  const unavailable = loading || acting !== null || !!loadError;

  return (
    <section className={styles.panel} aria-label="Worktrees">
      <div className={styles.toolbar}>
        <div>
          <h2 className={styles.heading}>Worktrees</h2>
          <p className={styles.meta}>{trees.length} extra checkout{trees.length === 1 ? "" : "s"}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className="btn btn-ghost" aria-label="Refresh worktrees" title="Refresh worktrees" disabled={loading || acting !== null} onClick={() => void refresh()}>
            <RefreshCw size={16} className={loading ? "animate-spin" : undefined} />
          </button>
          <button type="button" className="btn btn-ghost" disabled={unavailable} onClick={() => void addWorktree()}>
            {acting === "add" ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />} New worktree
          </button>
        </div>
      </div>

      {loadError ? <FetchError message={loadError} onRetry={() => void refresh()} bare /> : <div className={styles.summary} aria-live="polite">
        <div>
          <strong>{loading ? "Checking cleanup status…" : merged.length ? `${merged.length} ready to remove` : "Nothing ready to remove"}</strong>
          <p>{merged.length ? "Merged changes are verified. Review local files before removing." : trees.length ? "Your remaining checkouts are being kept. See the reason below." : "Only your main checkout remains."}</p>
        </div>
        {merged.length > 0 && <button type="button" className="btn btn-ghost" disabled={unavailable} onClick={() => { setSelected(merged.map((tree) => tree.path)); setIncludeIgnored(false); }}>
          Select ready ({merged.length})
        </button>}
      </div>}

      {chosen.length > 0 && <div className={styles.selection}>
        <div className={styles.toolbar}>
          <strong>{chosen.length} selected · {formatWorktreeSize(chosen.reduce((sum, tree) => sum + (tree.details?.sizeBytes ?? 0), 0))}</strong>
          <button type="button" className="btn btn-ghost" disabled={acting !== null} onClick={() => { setSelected([]); setIncludeIgnored(false); }}>Clear</button>
        </div>
        {selectedHasIgnored && <>
          <details className={styles.details}>
            <summary>Local files included in removal</summary>
            <div className={styles.detailsBody}>{chosen.filter((tree) => tree.details?.ignoredPaths.length).map((tree) => <div key={tree.path}>
              <strong>{tree.title}</strong>
              <ul>{tree.details!.ignoredPaths.map((file) => <li key={file}>{file}</li>)}</ul>
            </div>)}</div>
          </details>
          <label className={styles.selectLabel}><input type="checkbox" disabled={acting !== null} checked={includeIgnored} onChange={(event) => setIncludeIgnored(event.target.checked)} /> I reviewed these local files and agree to delete them</label>
        </>}
        <button type="button" className="btn btn-danger-ghost" disabled={unavailable || (!includeIgnored && selectedHasIgnored)} onClick={() => void removeWorktree()}>
          <Trash2 size={14} /> {acting === "cleanup" ? "Removing…" : `Remove ${chosen.length} checkout${chosen.length === 1 ? "" : "s"}`}
        </button>
      </div>}

      <ul className={styles.list} aria-label="Extra checkouts">
        {trees.map((tree) => <li key={tree.path} className={styles.row}>
          <div className={styles.rowHeader}>
            <h3 className={styles.title}>{tree.title}</h3>
            <WorktreeStatus tree={tree} />
          </div>
          <p className={styles.meta}>{formatWorktreeSize(tree.details?.sizeBytes)}{tree.details?.dirtyCount ? ` · ${tree.details.dirtyCount} changed files` : ""}</p>
          {isWorktreeCleanupReady(tree) && <label className={styles.selectLabel}>
            <input type="checkbox" aria-label={`Select ${tree.title} for removal`} disabled={unavailable} checked={selected.includes(tree.path)} onChange={(event) => { setSelected(event.target.checked ? [...selected, tree.path] : selected.filter((item) => item !== tree.path)); setIncludeIgnored(false); }} />
            Select for removal
          </label>}
          <WorktreeDetails tree={tree}>
            <button type="button" className="btn btn-ghost" disabled={unavailable} onClick={() => void simpleAction(tree.locked ? "unlock" : "lock", tree)}>
              {tree.locked ? <LockOpen size={14} /> : <Lock size={14} />} {tree.locked ? "Unlock checkout" : "Keep this checkout"}
            </button>
          </WorktreeDetails>
        </li>)}
      </ul>

      {main && <details className={styles.support}>
        <summary>Main checkout <span className="badge badge-muted">Always kept</span></summary>
        <div className={styles.detailsBody}>
          <p>{main.branch || `Detached at ${main.head.slice(0, 7)}`}</p>
          <p className={styles.path}>{main.path}</p>
          <p>Cleanup never removes the repository’s main checkout.</p>
        </div>
      </details>}

      <details className={styles.support}>
        <summary>How cleanup works</summary>
        <div className={styles.detailsBody}>
          <ol>
            <li>Finishing a task unpins its Paseo workspace. Its checkout stays on disk.</li>
            <li>After merge, DevHub checks that the checkout’s changes are included and there is no unfinished local work.</li>
            <li>Select ready checkouts, review their local files, then confirm removal. Branches and commits stay.</li>
          </ol>
          <p>Weekly reviews report candidates. They do not delete files.</p>
        </div>
      </details>
      <WorktreeSchedule />
      {stale.length > 0 && <div className={styles.summary}>
        <p>{stale.length} checkout folder{stale.length === 1 ? " is" : "s are"} already missing.</p>
        <button type="button" className="btn btn-ghost" disabled={unavailable} onClick={() => void simpleAction("prune")}>
          <Unlink size={14} /> Clear missing entries
        </button>
      </div>}
    </section>
  );
}
