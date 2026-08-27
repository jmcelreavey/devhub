"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CornerDownLeft,
  Download,
  GitCompare,
  GitMerge,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
  type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import { useConfirm, useDecision, usePrompt } from "@/components/shell/ConfirmDialog";
import { groupBranches } from "@/lib/repos/branch-grouping";
import { RemotesSection } from "./RemotesSection";
import { useToast } from "@/lib/hooks/use-toast";
import {
  BRANCH_ACTION_SUCCESS_LABELS,
  buildBranchMenuGroups,
  type BranchMenuState,
} from "./branchMenuGroups";
import { RangeCompareModal } from "./RangeCompareModal";
import {
  chooseCheckoutStrategy,
  fetchGitJson,
  postGitAction,
  repoApi,
  type BranchInfo,
  type BranchesPayload,
  type GitPanelHandlers,
  type RemoteBranchInfo,
} from "./shared";

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
  const decide = useDecision();
  const prompt = usePrompt();
  const [data, setData] = useState<BranchesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [compareBranch, setCompareBranch] = useState<string | null>(null);
  const [branchQuery, setBranchQuery] = useState("");
  const menu = useContextMenu<BranchInfo>();
  const remoteMenu = useContextMenu<RemoteBranchInfo>();

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

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      // Silent (poll) refreshes skip the skeleton flash and error toasts — a
      // failed background poll shouldn't nag while the stale list is still shown.
      if (!opts?.silent) setLoading(true);
      try {
        setData(await fetchGitJson<BranchesPayload>(repoApi(repoName, "/branches")));
      } catch (err) {
        if (!opts?.silent) toast.error(err instanceof Error ? err.message : "Branches failed");
      } finally {
        setLoading(false);
      }
    },
    [repoName, toast],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch branches on mount / repo change
    void refresh();
    // Branch state changes outside this panel (terminal commits, pushes from
    // other tools), so poll quietly instead of waiting for a manual refresh.
    const timer = setInterval(() => void refresh({ silent: true }), 15_000);
    return () => clearInterval(timer);
    // Keyed on repoName only: a new toast/callback identity must not reset the poll cadence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoName]);

  const act = useCallback(
    async (action: string, extra?: Record<string, unknown>) => {
      setActing(action);
      try {
        let result = await postGitAction<{
          alreadyUpToDate?: boolean;
          message?: string;
          branch?: string;
          backupBranch?: string | null;
        }>(repoApi(repoName, "/branches"), { action, ...extra });
        if (!result.ok && result.kind === "checkout-conflict") {
          const strategy = await chooseCheckoutStrategy(decide, result.conflict);
          if (!strategy) return false;
          result = await postGitAction(repoApi(repoName, "/branches"), {
            action,
            ...extra,
            strategy,
          });
        }
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
            BRANCH_ACTION_SUCCESS_LABELS[action]?.(label) ??
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
    [decide, repoName, onConflict, onHookFailure, onMutate, refresh, toast],
  );

  const checkoutBranch = useCallback(
    async (branch: string) => {
      await act("checkout", { branch });
    },
    [act],
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

  /** Toolbar-only: the diverged pull buttons. The context menu has its own copy. */
  const pullWith = useCallback(
    async (action: "pull-rebase" | "pull-merge") => {
      const ok = await confirm({
        title: action === "pull-rebase" ? "Pull with rebase?" : "Pull with merge?",
        message:
          action === "pull-rebase"
            ? "git pull --rebase. Replays your local commits on top of upstream. No merge commit. Conflicts open in the Conflicts tab."
            : "git pull --no-rebase. Merges upstream into this branch. Conflicts open in the Conflicts tab.",
        confirmLabel: action === "pull-rebase" ? "Rebase pull" : "Merge pull",
        variant: action === "pull-rebase" ? "danger" : undefined,
      });
      if (ok) await act(action);
    },
    [act, confirm],
  );

  const pruneBackups = useCallback(async () => {    const ok = await confirm({
      title: "Prune backup branches?",
      message:
        "Deletes `devhub/backup-*` branches except the newest 10 and anything from the last 14 days. Never deletes the current branch.",
      confirmLabel: "Prune backups",
      variant: "danger",
    });
    if (ok) await act("prune-backup-branches");
  }, [act, confirm]);

  const syncWithMain = useCallback(async () => {
    const target = data?.mainBranch ?? "main";
    const ok = await confirm({
      title: `Sync with ${target}?`,
      message: `Stashes any local work, fetches ${target}, merges it into ${
        data?.currentBranch ?? "this branch"
      }, pushes, then restores the stash. Conflicts open in the Conflicts tab.`,
      confirmLabel: "Sync",
    });
    if (ok) await act("sync-main");
  }, [act, confirm, data?.mainBranch, data?.currentBranch]);

  const branchMenuState = useCallback(
    (): BranchMenuState => ({
      currentBranch: data?.currentBranch ?? "",
      mainBranch: data?.mainBranch ?? null,
      defaultRemote: data?.remotes?.[0]?.name ?? "origin",
      remoteWebUrl: data?.remoteWebUrl ?? null,
      busy: acting !== null,
      pushing,
      dirty: Boolean(data?.hasChanges),
      currentUpstream: data?.upstream ?? null,
      currentAhead: data?.ahead ?? 0,
      currentBehind: data?.behind ?? 0,
    }),
    [data, acting, pushing],
  );

  /**
   * The right-click menu, shared with the Git rail via buildBranchMenuGroups
   * so the two surfaces offer the same actions and never drift.
   */
  const menuGroups = useMemo((): ContextMenuGroup[] => {
    const branch = menu.target;
    if (!branch || !data) return [];
    return buildBranchMenuGroups(
      {
        name: branch.name,
        current: branch.current,
        upstream: branch.upstream,
        ahead: branch.ahead,
        behind: branch.behind,
        upstreamGone: branch.upstreamGone,
      },
      branchMenuState(),
      {
        confirm,
        prompt,
        toast,
        run: act,
        checkout: (name) => void checkoutBranch(name),
        checkoutRemote: (t) =>
          void checkoutRemoteBranch({
            name: t.name,
            remote: t.name.split("/")[0] ?? "origin",
            localName: t.localName ?? t.name.replace(/^[^/]+\//, ""),
            shortHash: "",
            trackedLocalName: t.trackedLocalName ?? null,
          }),
        onPush,
        onCompare: (name) => setCompareBranch(name),
      },
    );
  }, [
    menu.target,
    data,
    branchMenuState,
    act,
    onPush,
    checkoutBranch,
    checkoutRemoteBranch,
    confirm,
    prompt,
    toast,
  ]);

  const remoteMenuGroups = useMemo((): ContextMenuGroup[] => {
    const branch = remoteMenu.target;
    if (!branch || !data) return [];
    return buildBranchMenuGroups(
      {
        name: branch.name,
        current: false,
        remote: true,
        localName: branch.localName,
        trackedLocalName: branch.trackedLocalName,
      },
      branchMenuState(),
      {
        confirm,
        prompt,
        toast,
        run: act,
        checkout: (name) => void checkoutBranch(name),
        checkoutRemote: (t) =>
          void checkoutRemoteBranch({
            name: t.name,
            remote: t.name.split("/")[0] ?? "origin",
            localName: t.localName ?? t.name.replace(/^[^/]+\//, ""),
            shortHash: "",
            trackedLocalName: t.trackedLocalName ?? null,
          }),
        onPush,
        onCompare: (name) => setCompareBranch(name),
      },
    );
  }, [
    remoteMenu.target,
    data,
    branchMenuState,
    act,
    onPush,
    checkoutBranch,
    checkoutRemoteBranch,
    confirm,
    prompt,
    toast,
  ]);

  if (loading && !data) return <SkeletonRows count={5} height={28} />;

  const behind = data?.behind ?? 0;
  const ahead = data?.ahead ?? 0;
  const hasUpstream = Boolean(data?.upstream);
  const diverged = ahead > 0 && behind > 0;
  const canPull = hasUpstream && behind > 0;
  const canFfPull = canPull && !diverged;
  const pullTitle = !hasUpstream
    ? "No upstream configured"
    : behind === 0
      ? ahead > 0
        ? "Nothing to pull — local is ahead of upstream"
        : "Already up to date"
      : diverged
        ? `Diverged from ${data?.upstream} — fast-forward pull will fail. Use rebase or merge.`
        : `Pull ${behind} commit${behind === 1 ? "" : "s"} from ${data?.upstream} (fast-forward only)`;
  const behindMain = data?.behindMain ?? 0;

  return (
    <div className="repo-git-branches">
      <div className="repo-git-changes-toolbar">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={acting !== null}
          title="Reload branches from git"
          onClick={() => void refresh()}
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : undefined} />
          Refresh
        </button>
        <button type="button" className="btn btn-ghost" disabled={acting !== null} onClick={() => void act("fetch")}>
          {acting === "fetch" ? <RefreshCw size={11} className="animate-spin" /> : <Download size={11} />}
          Fetch
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={acting !== null || !canFfPull}
          title={pullTitle}
          onClick={() => void act("pull")}
        >
          {acting === "pull" ? <RefreshCw size={11} className="animate-spin" /> : <CornerDownLeft size={11} />}
          {behind > 0 && !diverged ? `Pull ${behind}` : "Pull"}
        </button>
        {diverged && (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={acting !== null}
              title="git pull --rebase — replay local commits on upstream"
              onClick={() => void pullWith("pull-rebase")}
            >
              {acting === "pull-rebase" ? <RefreshCw size={11} className="animate-spin" /> : <CornerDownLeft size={11} />}
              Pull rebase
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={acting !== null}
              title="git pull --no-rebase — merge upstream into this branch"
              onClick={() => void pullWith("pull-merge")}
            >
              {acting === "pull-merge" ? <RefreshCw size={11} className="animate-spin" /> : <GitMerge size={11} />}
              Pull merge
            </button>
          </>
        )}
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
          <button type="button" className="btn btn-ghost" disabled={acting !== null} title={`Stash local work, merge ${data?.mainBranch}, push, and restore the stash`} onClick={() => void syncWithMain()}>
            {acting === "sync-main" ? <RefreshCw size={11} className="animate-spin" /> : <GitMerge size={11} />}
            Sync {behindMain}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={acting !== null}
          title="Delete old devhub/backup-* branches, keeping the newest 10 or last 14 days"
          onClick={() => void pruneBackups()}
        >
          {acting === "prune-backup-branches" ? <RefreshCw size={11} className="animate-spin" /> : <Trash2 size={11} />}
          Prune backups
        </button>
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
      <div className="repo-git-branch-hint">Double-click to switch. Right-click or ⋮ for merge, rebase, rename and more.</div>
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
            className="repo-git-branch-row group"
            data-current={b.current || undefined}
            {...menu.bindRow(b)}
          >
            <button
              type="button"
              className="repo-git-branch-main"
              disabled={b.current || acting !== null}
              title={b.current ? `${b.name} is checked out` : `Double-click to check out ${b.name}`}
              onDoubleClick={() => void checkoutBranch(b.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void checkoutBranch(b.name);
              }}
            >
              {b.current ? <Check size={12} className="text-accent" /> : <CornerDownLeft size={12} className="text-text-subtle" />}
              <span style={{ fontWeight: b.current ? 600 : 400 }}>{b.name}</span>
              {b.current && <span className="repo-git-ref-chip">current</span>}
              {!b.upstream && <span className="repo-git-ref-chip" data-tone="warning">local only</span>}
            </button>
            <RowMenuKebab
              label={`Actions for ${b.name}`}
              onOpen={(x, y) => menu.openAtPoint(x, y, b)}
            />
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
              <div
                key={branch.name}
                className="repo-git-branch-row group"
                {...remoteMenu.bindRow(branch)}
              >
                <button
                  type="button"
                  className="repo-git-branch-main"
                  disabled={acting !== null}
                  title={`Double-click to check out ${branch.name}`}
                  onDoubleClick={() =>
                    branch.trackedLocalName
                      ? void checkoutBranch(branch.trackedLocalName)
                      : void checkoutRemoteBranch(branch)
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    if (branch.trackedLocalName) void checkoutBranch(branch.trackedLocalName);
                    else void checkoutRemoteBranch(branch);
                  }}
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
                <RowMenuKebab
                  label={`Actions for ${branch.name}`}
                  onOpen={(x, y) => remoteMenu.openAtPoint(x, y, branch)}
                />
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
      <ContextMenu
        open={Boolean(remoteMenu.target)}
        position={remoteMenu.position}
        groups={remoteMenuGroups}
        onClose={remoteMenu.close}
        label={remoteMenu.target ? `Actions for ${remoteMenu.target.name}` : "Remote branch actions"}
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
