"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  Copy,
  CornerDownLeft,
  Download,
  ExternalLink,
  GitBranch,
  GitCompare,
  GitMerge,
  Link2,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Rewind,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { ContextMenu, useContextMenu, type ContextMenuGroup } from "@/components/shell/ContextMenu";
import { useConfirm, usePrompt } from "@/components/shell/ConfirmDialog";
import { groupBranches } from "@/lib/repos/branch-grouping";
import { RemotesSection } from "./RemotesSection";
import { copyTextToClipboard } from "@/lib/clipboard";
import { openInBrowser } from "@/lib/desktop/bridge";
import { useToast } from "@/lib/hooks/use-toast";
import { RangeCompareModal } from "./RangeCompareModal";
import {
  fetchGitJson,
  postGitAction,
  repoApi,
  type BranchInfo,
  type BranchesPayload,
  type GitPanelHandlers,
  type RemoteBranchInfo,
} from "./shared";

const ACTION_SUCCESS_LABELS: Record<string, (branch?: unknown) => string> = {
  checkout: (branch) => `Switched to ${branch}`,
  "create-branch": (branch) => `Created ${branch}`,
  "delete-branch": (branch) => `Deleted ${branch}`,
  fetch: () => "Fetched",
  pull: () => "Pulled",
  push: () => "Pushed",
  "force-push-with-lease": () => "Force-pushed with lease",
  "set-upstream": (branch) => `Tracking origin/${branch}`,
  "merge-branch": (branch) => `Merged ${branch}`,
  "rebase-branch": (branch) => `Rebased onto ${branch}`,
  "branch-from": (branch) => `Created ${branch}`,
  "rename-branch": (branch) => `Renamed to ${branch}`,
  "reset-to-branch": (branch) => `Reset to ${branch}`,
  "checkout-remote": (branch) => `Switched to ${branch}`,
  "sync-main": () => "Synced with main",
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
  const [compareBranch, setCompareBranch] = useState<string | null>(null);
  const [branchQuery, setBranchQuery] = useState("");
  const menu = useContextMenu<BranchInfo>();

  // Filter and group both lists. A team repo runs to dozens of branches and
  // this was a flat list, so the only way to find one was to read every row.
  const localGroups = useMemo(
    () => groupBranches(data?.branches ?? [], (b) => b.name, branchQuery),
    [data?.branches, branchQuery],
  );
  const remoteGroups = useMemo(
    () => groupBranches(data?.remoteBranches ?? [], (b) => b.name, branchQuery),
    [data?.remoteBranches, branchQuery],
  );

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

  const act = useCallback(
    async (action: string, extra?: Record<string, unknown>) => {
      setActing(action);
      try {
        const result = await postGitAction<{
          alreadyUpToDate?: boolean;
          message?: string;
          branch?: string;
          backupBranch?: string | null;
        }>(repoApi(repoName, "/branches"), { action, ...extra });
        if (!result.ok) {
          if (result.kind === "conflict") {
            await onConflict(result.conflict);
            onMutate();
            await refresh();
            return false;
          }
          if (result.kind === "hook") {
            onHookFailure(result.hook);
            return false;
          }
          throw new Error(result.message);
        }
        const label = (extra?.newBranch ?? extra?.branch) as unknown;
        if (result.json.alreadyUpToDate) {
          toast.success(result.json.message || "Already up to date.");
        } else {
          toast.success(
            ACTION_SUCCESS_LABELS[action]?.(label) ??
              result.json.message ??
              "Done",
          );
        }
        // A rewritten branch pointer leaves a recovery ref — say so once, where
        // the user can still act on it, rather than only in the server log.
        if (result.json.backupBranch) {
          toast.info(`Backup branch: ${result.json.backupBranch}`, { duration: 9000 });
        }
        onMutate();
        await refresh();
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Action failed");
        return false;
      } finally {
        setActing(null);
      }
    },
    [repoName, onConflict, onHookFailure, onMutate, refresh, toast],
  );

  const checkoutBranch = useCallback(
    async (branch: string) => {
      const dirty = Boolean(data?.hasChanges);
      const ok = await confirm({
        title: `Switch to ${branch}?`,
        message: dirty
          ? `Working tree has uncommitted changes. DevHub will auto-stash them, check out ${branch}, then re-apply the stash (conflicts go to the Conflicts tab).`
          : `Check out branch “${branch}”. Local HEAD will move; uncommitted work is none right now.`,
        confirmLabel: "Switch branch",
      });
      if (!ok) return;
      await act("checkout", { branch });
    },
    [act, confirm, data?.hasChanges],
  );

  const createBranch = useCallback(async () => {
    const name = await prompt({
      title: "Create branch",
      message: "New branch name (checked out from current HEAD).",
      input: { placeholder: "feature/my-work" },
      confirmLabel: "Create",
    });
    if (!name?.trim()) return;
    await act("create-branch", { branch: name.trim() });
  }, [act, prompt]);

  const forcePushWithLease = useCallback(async () => {
    const ok = await confirm({
      title: "Force-push rewritten history?",
      message:
        "Uses git push --force-with-lease. The push is rejected if the remote changed since your last fetch.",
      confirmLabel: "Force-push with lease",
      variant: "danger",
    });
    if (ok) await act("force-push-with-lease");
  }, [act, confirm]);

  const checkoutRemoteBranch = useCallback(
    async (branch: RemoteBranchInfo) => {
      const name = await prompt({
        title: `Check out ${branch.name}`,
        message: `Creates a local branch that tracks ${branch.name}.`,
        input: { placeholder: branch.localName, defaultValue: branch.localName },
        confirmLabel: "Check out",
      });
      if (!name?.trim()) return;
      await act("checkout-remote", { branch: branch.name, newBranch: name.trim() });
    },
    [act, prompt],
  );

  const deleteBranch = useCallback(
    async (branch: string) => {
      const ok = await confirm({
        title: `Delete branch ${branch}?`,
        message: "Uses git branch -d (safe delete) — git refuses if the branch has unmerged work.",
        confirmLabel: "Delete",
        variant: "danger",
      });
      if (!ok) return;
      await act("delete-branch", { branch });
    },
    [act, confirm],
  );

  const forceDeleteBranch = useCallback(
    async (branch: string) => {
      const ok = await confirm({
        title: `Force-delete ${branch}?`,
        message:
          "git branch -D. Commits only on this branch are no longer reachable by name — recoverable from the reflog for a while, then gone.",
        confirmLabel: "Force delete",
        variant: "danger",
      });
      if (!ok) return;
      await act("delete-branch", { branch, force: true });
    },
    [act, confirm],
  );

  const mergeIntoCurrent = useCallback(
    async (branch: string, current: string) => {
      const ok = await confirm({
        title: `Merge ${branch} into ${current}?`,
        message: `Runs git merge --no-edit ${branch} on ${current}. Conflicts open in the Conflicts tab; nothing is pushed.`,
        confirmLabel: "Merge",
      });
      if (!ok) return;
      await act("merge-branch", { branch });
    },
    [act, confirm],
  );

  const rebaseOnto = useCallback(
    async (branch: string, current: string) => {
      const ok = await confirm({
        title: `Rebase ${current} onto ${branch}?`,
        message: `Replays every commit on ${current} on top of ${branch}, rewriting their hashes. DevHub takes a backup branch first and aborts the rebase if anything conflicts.`,
        confirmLabel: "Rebase",
        variant: "danger",
      });
      if (!ok) return;
      await act("rebase-branch", { branch });
    },
    [act, confirm],
  );

  const branchFrom = useCallback(
    async (branch: string) => {
      const name = await prompt({
        title: `New branch from ${branch}`,
        message: `Creates a branch at ${branch}'s tip. Your checkout does not move.`,
        input: { placeholder: "feature/my-work" },
        confirmLabel: "Create",
      });
      if (!name?.trim()) return;
      await act("branch-from", { branch, newBranch: name.trim() });
    },
    [act, prompt],
  );

  const renameBranch = useCallback(
    async (branch: string) => {
      const name = await prompt({
        title: `Rename ${branch}`,
        message:
          "Renames the local branch only. If it already tracks a remote branch, the remote name stays as it was.",
        input: { placeholder: branch, defaultValue: branch },
        confirmLabel: "Rename",
      });
      if (!name?.trim() || name.trim() === branch) return;
      await act("rename-branch", { branch, newBranch: name.trim() });
    },
    [act, prompt],
  );

  const resetCurrentTo = useCallback(
    async (branch: string, current: string) => {
      const ok = await confirm({
        title: `Reset ${current} to ${branch}?`,
        message: `Moves ${current} to ${branch} with git reset --hard: commits only on ${current} stop being reachable by name, and the working tree is replaced. Requires a clean tree; DevHub takes a backup branch first.`,
        confirmLabel: "Hard reset",
        variant: "danger",
      });
      if (!ok) return;
      await act("reset-to-branch", { branch, mode: "hard" });
    },
    [act, confirm],
  );

  const copyName = useCallback(
    async (branch: string) => {
      try {
        await copyTextToClipboard(branch);
        toast.success("Branch name copied");
      } catch {
        toast.error("Could not copy to the clipboard");
      }
    },
    [toast],
  );

  const openOnGitHub = useCallback(
    (branch: string) => {
      const base = data?.remoteWebUrl;
      if (!base) {
        toast.error("No browsable origin remote for this repo");
        return;
      }
      void openInBrowser(`${base}/tree/${encodeURIComponent(branch)}`);
    },
    [data?.remoteWebUrl, toast],
  );

  const openPullRequest = useCallback(
    (branch: string) => {
      const base = data?.remoteWebUrl;
      if (!base) {
        toast.error("No browsable origin remote for this repo");
        return;
      }
      const main = data?.mainBranch?.replace(/^origin\//, "") ?? "main";
      void openInBrowser(
        `${base}/compare/${encodeURIComponent(main)}...${encodeURIComponent(branch)}?expand=1`,
      );
    },
    [data?.remoteWebUrl, data?.mainBranch, toast],
  );

  /**
   * The right-click menu. Actions the branch cannot support are shown disabled
   * with the reason rather than hidden — a menu whose shape changes per row is
   * harder to learn than one where the same item is greyed out.
   */
  const menuGroups = useMemo((): ContextMenuGroup[] => {
    const branch = menu.target;
    if (!branch || !data) return [];
    const current = data.currentBranch;
    const isCurrent = branch.current;
    const busy = acting !== null;
    const hasRemote = Boolean(data.remoteWebUrl);
    const dirty = Boolean(data.hasChanges);

    return [
      {
        id: "move",
        items: [
          {
            id: "checkout",
            label: `Check out ${branch.name}`,
            description: dirty ? "Auto-stashes your changes first" : undefined,
            icon: <CornerDownLeft size={12} />,
            disabled: isCurrent || busy,
            disabledReason: isCurrent ? "Already checked out" : undefined,
            onSelect: () => void checkoutBranch(branch.name),
          },
          {
            id: "merge",
            label: `Merge into ${current}`,
            description: `git merge ${branch.name}`,
            icon: <GitMerge size={12} />,
            disabled: isCurrent || busy || dirty,
            disabledReason: isCurrent
              ? "That is the current branch"
              : dirty
                ? "Commit or stash your changes first"
                : undefined,
            onSelect: () => void mergeIntoCurrent(branch.name, current),
          },
          {
            id: "rebase",
            label: `Rebase ${current} onto this`,
            description: "Rewrites local commit hashes",
            icon: <Rewind size={12} />,
            danger: true,
            disabled: isCurrent || busy || dirty,
            disabledReason: isCurrent
              ? "That is the current branch"
              : dirty
                ? "Commit or stash your changes first"
                : undefined,
            onSelect: () => void rebaseOnto(branch.name, current),
          },
        ],
      },
      {
        id: "remote",
        label: "Remote",
        items: [
          {
            id: "push",
            label: `Push ${branch.name}`,
            description: branch.upstream
              ? `to ${branch.upstream}`
              : "Sets the upstream to origin on first push",
            icon: <Upload size={12} />,
            disabled: !isCurrent || busy || pushing,
            disabledReason: !isCurrent ? "Check the branch out first" : undefined,
            onSelect: onPush,
          },
          {
            id: "pull",
            label: "Pull",
            description: isCurrent ? "git pull --ff-only" : undefined,
            icon: <ArrowDownToLine size={12} />,
            disabled: !isCurrent || busy || !data.upstream || data.behind === 0,
            disabledReason: !isCurrent
              ? "Check the branch out to pull it"
              : !data.upstream
                ? "No upstream configured"
                : data.behind === 0
                  ? "Already up to date"
                  : undefined,
            onSelect: () => void act("pull"),
          },
          {
            id: "set-upstream",
            label: `Track origin/${branch.name}`,
            description: branch.upstream ? `Currently ${branch.upstream}` : undefined,
            icon: <Link2 size={12} />,
            disabled: busy || branch.upstream === `origin/${branch.name}`,
            disabledReason:
              branch.upstream === `origin/${branch.name}` ? "Already tracking it" : undefined,
            onSelect: () => void act("set-upstream", { branch: branch.name }),
          },
          {
            id: "force-push-with-lease",
            label: "Force-push with lease",
            description: "Publish rebased history without overwriting newer remote work",
            icon: <Upload size={12} />,
            danger: true,
            disabled: !isCurrent || busy || !branch.upstream,
            disabledReason: !isCurrent
              ? "Check the branch out first"
              : !branch.upstream
                ? "Push normally to create an upstream first"
                : undefined,
            onSelect: () => void forcePushWithLease(),
          },
        ],
      },
      {
        id: "inspect",
        label: "Inspect",
        items: [
          {
            id: "compare",
            label: `Compare with ${current}`,
            description: "Diff this whole branch against your checkout",
            icon: <GitCompare size={12} />,
            disabled: isCurrent,
            disabledReason: isCurrent ? "That is the current branch" : undefined,
            onSelect: () => setCompareBranch(branch.name),
          },
          {
            id: "copy",
            label: "Copy branch name",
            icon: <Copy size={12} />,
            onSelect: () => void copyName(branch.name),
          },
          {
            id: "open-pr",
            label: "Open pull request",
            description: `Compare against ${data.mainBranch?.replace(/^origin\//, "") ?? "main"} on the web`,
            icon: <ExternalLink size={12} />,
            disabled: !hasRemote,
            disabledReason: !hasRemote ? "No browsable origin remote" : undefined,
            onSelect: () => openPullRequest(branch.name),
          },
          {
            id: "open-web",
            label: "Open branch on the web",
            icon: <ExternalLink size={12} />,
            disabled: !hasRemote,
            disabledReason: !hasRemote ? "No browsable origin remote" : undefined,
            onSelect: () => openOnGitHub(branch.name),
          },
        ],
      },
      {
        id: "edit",
        label: "Modify",
        items: [
          {
            id: "branch-from",
            label: "New branch from here…",
            description: "Creates a branch at this tip without switching",
            icon: <GitBranch size={12} />,
            disabled: busy,
            onSelect: () => void branchFrom(branch.name),
          },
          {
            id: "rename",
            label: "Rename…",
            icon: <Pencil size={12} />,
            disabled: busy,
            onSelect: () => void renameBranch(branch.name),
          },
          {
            id: "reset",
            label: `Reset ${current} to here`,
            description: "Hard reset — discards commits only on the current branch",
            icon: <Rewind size={12} />,
            danger: true,
            disabled: isCurrent || busy || dirty,
            disabledReason: isCurrent
              ? "That is the current branch"
              : dirty
                ? "Commit or stash your changes first"
                : undefined,
            onSelect: () => void resetCurrentTo(branch.name, current),
          },
          {
            id: "delete",
            label: "Delete",
            description: "git branch -d — refuses if unmerged",
            icon: <Trash2 size={12} />,
            danger: true,
            disabled: isCurrent || busy,
            disabledReason: isCurrent ? "Cannot delete the current branch" : undefined,
            onSelect: () => void deleteBranch(branch.name),
          },
          {
            id: "force-delete",
            label: "Force delete",
            description: "git branch -D — drops unmerged commits",
            icon: <Trash2 size={12} />,
            danger: true,
            disabled: isCurrent || busy,
            disabledReason: isCurrent ? "Cannot delete the current branch" : undefined,
            onSelect: () => void forceDeleteBranch(branch.name),
          },
        ],
      },
    ];
  }, [
    menu.target,
    data,
    acting,
    pushing,
    act,
    onPush,
    checkoutBranch,
    mergeIntoCurrent,
    rebaseOnto,
    branchFrom,
    renameBranch,
    resetCurrentTo,
    deleteBranch,
    forceDeleteBranch,
    forcePushWithLease,
    copyName,
    openOnGitHub,
    openPullRequest,
  ]);

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
  const behindMain = data?.behindMain ?? 0;

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
        {(ahead > 0 || pushing) && behind === 0 && (
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
        {behindMain > 0 && (
          <button type="button" className="btn btn-ghost" disabled={acting !== null} title={`Stash local work, merge ${data?.mainBranch}, push, and restore the stash`} onClick={() => void act("sync-main")}>
            {acting === "sync-main" ? <RefreshCw size={11} className="animate-spin" /> : <GitMerge size={11} />}
            Sync {behindMain}
          </button>
        )}
        <div className="repo-git-spacer" />
        <span className="text-xs text-text-subtle">
          on <span className="text-accent">{data?.currentBranch}</span>
          {hasUpstream && (ahead > 0 || behind > 0) && (
            <span style={{ marginLeft: 6 }}>
              {ahead > 0 ? `↑${ahead}` : null}
              {ahead > 0 && behind > 0 ? " " : null}
              {behind > 0 ? `↓${behind}` : null}
            </span>
          )}
          {data?.mainBranch && <span style={{ marginLeft: 6 }}>{behindMain > 0 ? `${behindMain} behind main` : "aligned with main"}</span>}
        </span>
      </div>
      {/*
        Its own class rather than `.repo-git-filter`, which carries
        `flex: 1 1 180px`. That is right in the History toolbar — a horizontal
        row — but this panel is a flex *column*, so the same rule stretched the
        box to a third of the panel's height.
      */}
      <label className="repo-git-branch-filter">
        <Search size={12} aria-hidden />
        <span className="sr-only">Filter branches</span>
        <input
          type="search"
          placeholder="Filter branches…"
          value={branchQuery}
          onChange={(e) => setBranchQuery(e.target.value)}
          aria-label="Filter branches"
        />
      </label>
      <div className="repo-git-branch-hint">Right-click a branch for merge, rebase, rename and more.</div>
      <div className="repo-git-branch-list">
        {localGroups.length === 0 && branchQuery.trim() && (
          <div className="repo-git-empty-sm">No local branch matches “{branchQuery.trim()}”.</div>
        )}
        {localGroups.map((group) => (
          <div key={group.label || "_ungrouped"}>
            {group.label && (
              <div className="repo-git-branch-group">
                {group.label}
                <span className="repo-git-branch-group-count">{group.items.length}</span>
              </div>
            )}
            {group.items.map((b) => (
          <div
            key={b.name}
            className="repo-git-branch-row"
            data-current={b.current || undefined}
            onContextMenu={(e) => menu.openAt(e, b)}
          >
            <button
              type="button"
              className="repo-git-branch-main"
              disabled={b.current || acting !== null}
              onClick={() => void checkoutBranch(b.name)}
            >
              {b.current ? <Check size={12} className="text-accent" /> : <CornerDownLeft size={12} className="text-text-subtle" />}
              <span style={{ fontWeight: b.current ? 600 : 400 }}>{b.name}</span>
              {b.current && <span className="repo-git-ref-chip">current</span>}
              {!b.upstream && <span className="repo-git-ref-chip" data-tone="warning">local only</span>}
            </button>
            <button
              type="button"
              className="btn btn-ghost repo-git-icon-btn"
              aria-label={`Actions for ${b.name}`}
              title={`Actions for ${b.name}`}
              onClick={(e) => menu.openAt(e, b)}
            >
              <MoreVertical size={10} />
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
        ))}
      </div>
      {(data?.remoteBranches.length ?? 0) > 0 && (
        <>
          <div className="repo-git-branch-hint">Remote branches</div>
          <div className="repo-git-branch-list">
            {remoteGroups.map((group) => (
              <div key={group.label || "_ungrouped"}>
                {group.label && (
                  <div className="repo-git-branch-group">
                    {group.label}
                    <span className="repo-git-branch-group-count">{group.items.length}</span>
                  </div>
                )}
                {group.items.map((branch) => (
              <div key={branch.name} className="repo-git-branch-row">
                <button
                  type="button"
                  className="repo-git-branch-main"
                  disabled={acting !== null}
                  onClick={() =>
                    branch.trackedLocalName
                      ? void checkoutBranch(branch.trackedLocalName)
                      : void checkoutRemoteBranch(branch)
                  }
                >
                  <Download size={12} className="text-text-subtle" />
                  <span>{branch.name}</span>
                  {branch.trackedLocalName && (
                    <span className="repo-git-ref-chip">local: {branch.trackedLocalName}</span>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost repo-git-icon-btn"
                  aria-label={`Compare ${branch.name} with ${data?.currentBranch}`}
                  title={`Compare ${branch.name} with ${data?.currentBranch}`}
                  onClick={() => setCompareBranch(branch.name)}
                >
                  <GitCompare size={10} />
                </button>
              </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      <RemotesSection repoName={repoName} onMutate={refresh} />
      <ContextMenu
        open={Boolean(menu.target)}
        position={menu.position}
        groups={menuGroups}
        onClose={menu.close}
        label={menu.target ? `Actions for ${menu.target.name}` : "Branch actions"}
      />
      {compareBranch && (
        <RangeCompareModal
          repoName={repoName}
          open
          onClose={() => setCompareBranch(null)}
          currentBranch={data?.currentBranch}
          head={compareBranch}
          base={data?.currentBranch}
          title={`Compare ${compareBranch} with ${data?.currentBranch}`}
        />
      )}
    </div>
  );
}
