"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CornerDownLeft, Download, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { SkeletonRows } from "@/components/SkeletonRows";
import { useConfirm, usePrompt } from "@/components/ConfirmDialog";
import { useToast } from "@/lib/use-toast";
import {
  fetchGitJson,
  postGitAction,
  repoApi,
  type BranchesPayload,
  type GitPanelHandlers,
} from "./shared";

const ACTION_SUCCESS_LABELS: Record<string, (branch?: unknown) => string> = {
  checkout: (branch) => `Switched to ${branch}`,
  "create-branch": (branch) => `Created ${branch}`,
  "delete-branch": (branch) => `Deleted ${branch}`,
  fetch: () => "Fetched",
  pull: () => "Pulled",
  push: () => "Pushed",
};

export function BranchesPanel({
  repoName,
  onMutate,
  onConflict,
  onHookFailure,
  pushing,
  onPush,
}: GitPanelHandlers & {
  repoName: string;
  pushing: boolean;
  onPush: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [data, setData] = useState<BranchesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchGitJson<BranchesPayload>(repoApi(repoName, "/branches")));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Branches failed");
    } finally {
      setLoading(false);
    }
  }, [repoName, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch branches on mount / repo change
    void refresh();
  }, [refresh]);

  async function act(action: string, extra?: Record<string, unknown>) {
    setActing(action);
    try {
      const result = await postGitAction<{ alreadyUpToDate?: boolean; message?: string }>(
        repoApi(repoName, "/branches"),
        { action, ...extra },
      );
      if (!result.ok) {
        if (result.kind === "conflict") {
          await onConflict(result.conflict);
          onMutate();
          await refresh();
          return;
        }
        if (result.kind === "hook") {
          onHookFailure(result.hook);
          return;
        }
        throw new Error(result.message);
      }
      if (action === "pull" && result.json.alreadyUpToDate) {
        toast.success(result.json.message || "Already up to date — nothing to pull.");
      } else {
        toast.success(ACTION_SUCCESS_LABELS[action]?.(extra?.branch) ?? "Done");
      }
      onMutate();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(null);
    }
  }

  async function createBranch() {
    const name = await prompt({
      title: "Create branch",
      message: "New branch name (checked out from current HEAD).",
      input: { placeholder: "feature/my-work" },
      confirmLabel: "Create",
    });
    if (!name?.trim()) return;
    await act("create-branch", { branch: name.trim() });
  }

  async function deleteBranch(branch: string) {
    const ok = await confirm({
      title: `Delete branch ${branch}?`,
      message: "Uses git branch -d (safe delete). Force only if you confirm again on failure.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    await act("delete-branch", { branch });
  }

  if (loading && !data) return <SkeletonRows count={5} height={28} />;

  const behind = data?.behind ?? 0;
  const ahead = data?.ahead ?? 0;
  const hasUpstream = Boolean(data?.upstream);
  const canPull = hasUpstream && behind > 0;
  const pullTitle = !hasUpstream
    ? "No upstream configured"
    : behind === 0
      ? ahead > 0
        ? "Nothing to pull — local is ahead of upstream"
        : "Already up to date"
      : `Pull ${behind} commit${behind === 1 ? "" : "s"} from ${data?.upstream} (fast-forward only)`;

  return (
    <div className="repo-git-branches">
      <div className="repo-git-changes-toolbar">
        <button type="button" className="btn btn-ghost" disabled={acting !== null} onClick={() => void act("fetch")}>
          {acting === "fetch" ? <RefreshCw size={11} className="animate-spin" /> : <Download size={11} />}
          Fetch
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={acting !== null || !canPull}
          title={pullTitle}
          onClick={() => void act("pull")}
        >
          {acting === "pull" ? <RefreshCw size={11} className="animate-spin" /> : <CornerDownLeft size={11} />}
          {behind > 0 ? `Pull ${behind}` : "Pull"}
        </button>
        {(ahead > 0 || pushing) && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={acting !== null || pushing}
            title={pushing ? "Push in progress…" : `Push ${ahead} local commit${ahead === 1 ? "" : "s"}`}
            onClick={onPush}
          >
            {pushing ? <RefreshCw size={11} className="animate-spin" /> : <Upload size={11} />}
            {pushing ? "Pushing…" : `Push ${ahead}`}
          </button>
        )}
        <button type="button" className="btn btn-ghost" disabled={acting !== null} onClick={() => void createBranch()}>
          <Plus size={11} /> New branch
        </button>
        <div className="repo-git-spacer" />
        <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
          on <span style={{ color: "var(--accent)" }}>{data?.currentBranch}</span>
          {hasUpstream && (ahead > 0 || behind > 0) && (
            <span style={{ marginLeft: 6 }}>
              {ahead > 0 ? `↑${ahead}` : null}
              {ahead > 0 && behind > 0 ? " " : null}
              {behind > 0 ? `↓${behind}` : null}
            </span>
          )}
        </span>
      </div>
      <div className="repo-git-branch-list">
        {(data?.branches ?? []).map((b) => (
          <div key={b.name} className="repo-git-branch-row" data-current={b.current || undefined}>
            <button
              type="button"
              className="repo-git-branch-main"
              disabled={b.current || acting !== null}
              onClick={() => void act("checkout", { branch: b.name })}
            >
              {b.current ? <Check size={12} style={{ color: "var(--accent)" }} /> : <CornerDownLeft size={12} style={{ color: "var(--text-subtle)" }} />}
              <span style={{ fontWeight: b.current ? 600 : 400 }}>{b.name}</span>
              {b.current && <span className="repo-git-ref-chip">current</span>}
            </button>
            {!b.current && (
              <button
                type="button"
                className="btn btn-ghost repo-git-icon-btn"
                data-danger
                aria-label={`Delete branch ${b.name}`}
                disabled={acting !== null}
                onClick={() => void deleteBranch(b.name)}
              >
                <Trash2 size={10} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
