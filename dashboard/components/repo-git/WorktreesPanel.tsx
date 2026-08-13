"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderTree, Lock, LockOpen, Plus, RefreshCw, Trash2, Unlink } from "lucide-react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useConfirm, usePrompt } from "@/components/shell/ConfirmDialog";
import { useToast } from "@/lib/hooks/use-toast";
import { defaultWorktreePath, type Worktree } from "@/lib/repos/worktree-parsers";
import { fetchGitJson, repoApi } from "./shared";

interface WorktreesPayload {
  worktrees: Worktree[];
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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchGitJson<WorktreesPayload>(repoApi(repoName, "/git/worktrees")));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not list worktrees");
    } finally {
      setLoading(false);
    }
  }, [repoName, toast]);

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

  const removeWorktree = useCallback(
    async (tree: Worktree) => {
      const ok = await confirm({
        // The dialog renders its message as a single paragraph, so a newline
        // between the path and the explanation just ran them together.
        title: `Remove the worktree at ${tree.path}?`,
        message: `The branch ${tree.branch ?? "(detached)"} and its commits stay — only this checkout folder is removed.`,
        confirmLabel: "Remove",
        variant: "danger",
      });
      if (!ok) return;
      setActing(tree.path);
      try {
        let result = await post({ action: "remove", path: tree.path });
        if (!result.ok && result.code === "worktree_dirty") {
          // Git refuses a dirty worktree, which is the right default. Offering
          // force here names what is being discarded rather than retrying blind.
          const forceOk = await confirm({
            title: "This worktree has uncommitted changes",
            message: `${tree.path} has modified or untracked files. Removing it discards them permanently.`,
            confirmLabel: "Discard and remove",
            variant: "danger",
          });
          if (!forceOk) return;
          result = await post({ action: "remove", path: tree.path, force: true });
        }
        if (!result.ok) throw new Error(result.error ?? "Could not remove the worktree");
        toast.success("Worktree removed");
        onMutate();
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not remove the worktree");
      } finally {
        setActing(null);
      }
    },
    [confirm, post, toast, onMutate, refresh],
  );

  const simpleAction = useCallback(
    async (action: "prune" | "lock" | "unlock", tree?: Worktree) => {
      setActing(tree?.path ?? action);
      try {
        const result = await post({ action, path: tree?.path });
        if (!result.ok) throw new Error(result.error ?? `Could not ${action}`);
        toast.success(action === "prune" ? "Pruned stale worktrees" : `Worktree ${action}ed`);
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Could not ${action}`);
      } finally {
        setActing(null);
      }
    },
    [post, toast, refresh],
  );

  if (loading && !data) return <SkeletonRows count={4} height={32} />;

  const trees = data?.worktrees ?? [];
  const hasPrunable = trees.some((t) => t.prunable);

  return (
    <div className="repo-git-history">
      <div className="repo-git-changes-toolbar">
        <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
          <RefreshCw size={11} className={loading ? "animate-spin" : undefined} /> Refresh
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={acting !== null}
          onClick={() => void addWorktree()}
        >
          {acting === "add" ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />}
          New worktree
        </button>
        {hasPrunable && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={acting !== null}
            title="Forget worktrees whose folder no longer exists"
            onClick={() => void simpleAction("prune")}
          >
            <Unlink size={11} /> Prune stale
          </button>
        )}
      </div>
      <div className="repo-git-branch-hint">
        A worktree is a second checkout backed by this same repository, so two branches can
        be open at once without stashing. Handy when an agent is working one branch while
        you are on another.
      </div>
      <div className="repo-git-branch-list">
        {trees.length === 0 && <div className="repo-git-empty-sm">No worktrees.</div>}
        {trees.map((tree) => (
          <div
            key={tree.path}
            className="repo-git-branch-row"
            data-current={tree.isMain || undefined}
            data-unreachable={tree.prunable || undefined}
          >
            <div className="repo-git-branch-main" style={{ cursor: "default" }}>
              <FolderTree size={12} className={tree.isMain ? "text-accent" : "text-text-subtle"} />
              <span style={{ fontWeight: tree.isMain ? 600 : 400 }}>
                {tree.branch ?? "(detached)"}
              </span>
              {tree.isMain && <span className="repo-git-ref-chip">this checkout</span>}
              {tree.locked && (
                <span className="repo-git-ref-chip" title={tree.lockReason || "Locked"}>
                  locked
                </span>
              )}
              {tree.prunable && (
                <span className="repo-git-ref-chip" data-tone="warning">
                  folder missing
                </span>
              )}
              <span className="truncate text-text-subtle" title={tree.path}>
                {tree.path}
              </span>
            </div>
            {!tree.isMain && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost repo-git-icon-btn"
                  aria-label={tree.locked ? `Unlock ${tree.path}` : `Lock ${tree.path}`}
                  title={
                    tree.locked
                      ? "Unlock so it can be removed or pruned"
                      : "Lock to stop it being removed or pruned"
                  }
                  disabled={acting !== null}
                  onClick={() => void simpleAction(tree.locked ? "unlock" : "lock", tree)}
                >
                  {tree.locked ? <LockOpen size={10} /> : <Lock size={10} />}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost repo-git-icon-btn"
                  data-danger
                  aria-label={`Remove worktree ${tree.path}`}
                  disabled={acting !== null}
                  onClick={() => void removeWorktree(tree)}
                >
                  {acting === tree.path ? (
                    <RefreshCw size={10} className="animate-spin" />
                  ) : (
                    <Trash2 size={10} />
                  )}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {data?.repoRoot && (
        <div className="repo-git-branch-hint">
          New worktrees are created beside the repository, e.g.{" "}
          <span className="font-mono">{defaultWorktreePath(data.repoRoot, "example")}</span>
        </div>
      )}
    </div>
  );
}
