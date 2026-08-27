"use client";

import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Layers, Tag } from "lucide-react";
import { ContextMenu, useContextMenu } from "@/components/shell/ContextMenu";
import { useConfirm, useDecision, usePrompt } from "@/components/shell/ConfirmDialog";
import { useToast } from "@/lib/hooks/use-toast";
import { openInBrowser } from "@/lib/desktop/bridge";
import type { GitHookFailurePayload, StashConflictPayload } from "@/app/repos/types";
import {
  BRANCH_ACTION_SUCCESS_LABELS,
  buildBranchMenuGroups,
  type BranchMenuTarget,
} from "./branchMenuGroups";
import { chooseCheckoutStrategy, fetchGitJson, postGitAction, repoApi, type RepoGitTabId } from "./shared";
export interface RailSummary {
  currentBranch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  mainBranch: string | null;
  defaultRemote: string;
  remoteWebUrl: string | null;
  stashes: number;
  /** Unresolved merge conflicts — switches are blocked while > 0. */
  conflicts: number;
  staged: number;
  unstaged: number;
  branches: {
    name: string;
    current: boolean;
    upstream?: string | null;
    ahead?: number;
    behind?: number;
    upstreamGone?: boolean;
    pushedElsewhereRef?: string;
    worktreePath?: string;
    staleDays?: number;
  }[];
  remoteBranches: {
    name: string;
    remote: string;
    localName: string;
    trackedLocalName: string | null;
  }[];
  tags: string[];
}

/** Toggleable section header. Module-level: a component defined inside the
 *  parent would remount (and lose focus) on every render. */
function SectionHeader({
  label,
  count,
  open,
  onToggle,
  icon,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="repo-git-section-label repo-git-rail-toggle"
      aria-expanded={open}
      onClick={onToggle}
    >
      {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
      {icon}
      {label}
      <span className="badge badge-muted">{count}</span>
    </button>
  );
}

/**
 * Persistent left column inside the Git workspace.
 *
 * Tabs hide state behind mode switches; the rail keeps branches, remotes,
 * tags and stashes visible no matter which tab is open — the thing that makes
 * a git GUI feel like a place rather than a stack of dialogs. Branch rows are
 * drop targets for the History tab's commit drag (data-drop-branch).
 */
export function GitRail({
  repoName,
  summary,
  onMutate,
  onConflict,
  onHookFailure,
  onOpenTab,
  pushing,
  onPush,
}: {
  repoName: string;
  summary: RailSummary | null;
  onMutate: () => void;
  onConflict: (c: StashConflictPayload) => Promise<void>;
  onHookFailure: (f: GitHookFailurePayload) => void;
  onOpenTab: (tab: RepoGitTabId) => void;
  pushing: boolean;
  onPush: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const decide = useDecision();
  const prompt = usePrompt();
  const branchMenu = useContextMenu<BranchMenuTarget>();
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  // Every section toggles — long tag/branch lists shouldn't push the rest of
  // the rail out of reach, and a collapsed section reads as skippable.
  const [branchesOpen, setBranchesOpen] = useState(true);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [stashOpen, setStashOpen] = useState(false);

  const localBranches = useMemo(() => summary?.branches ?? [], [summary]);
  const remoteOnly = useMemo(
    () =>
      (summary?.remoteBranches ?? []).filter((r) => !r.trackedLocalName),
    [summary],
  );

  interface RailPr {
    headBranch: string;
    number: number;
    title: string;
    url: string;
    checks: string;
  }
  /**
   * Open PRs, one gh call for the whole repo. Lazily fetched so a slow or
   * missing gh costs nothing — badges arrive late and swap in quietly.
   */
  const [prsByBranch, setPrsByBranch] = useState<Record<string, RailPr>>({});
  // Repo switches clear stale badges during render (React adjust-state
  // pattern) rather than inside the fetch effect.
  const [seenPrRepo, setSeenPrRepo] = useState(repoName);
  if (seenPrRepo !== repoName) {
    setSeenPrRepo(repoName);
    setPrsByBranch({});
  }
  useEffect(() => {
    let live = true;
    void fetchGitJson<{ prs: RailPr[] }>(repoApi(repoName, "/git/branch-prs"))
      .then((json) => {
        if (!live) return;
        const map: Record<string, RailPr> = {};
        for (const pr of json.prs ?? []) map[pr.headBranch] = pr;
        setPrsByBranch(map);
      })
      .catch(() => {
        // No gh / rate-limited — the badge simply doesn't show.
      });
    return () => {
      live = false;
    };
  }, [repoName]);

  function canCheckout(branch: string): boolean {
    // Git refuses a second checkout of a branch held by another worktree —
    // say so up front instead of failing after the confirm.
    const wtPath = summary?.branches.find((b) => b.name === branch)?.worktreePath;
    if (wtPath) {
      toast.info(
        `${branch} is already checked out at ${wtPath} — switch that worktree off the branch first.`,
        { duration: 9000 },
      );
      return false;
    }
    const conflicts = summary?.conflicts ?? 0;
    if (conflicts > 0) {
      toast.info(
        `Resolve or abort ${conflicts} existing conflict${conflicts === 1 ? "" : "s"} before switching branches.`,
      );
      return false;
    }
    return true;
  }

  async function checkout(branch: string) {
    if (busyBranch) return;
    if (!canCheckout(branch)) return;
    setBusyBranch(branch);
    try {
      let result = await postGitAction(repoApi(repoName, "/branches"), {
        action: "checkout",
        branch,
      });
      if (!result.ok && result.kind === "checkout-conflict") {
        const strategy = await chooseCheckoutStrategy(decide, result.conflict);
        if (!strategy) return;
        result = await postGitAction(repoApi(repoName, "/branches"), {
          action: "checkout",
          branch,
          strategy,
        });
      }
      if (!result.ok) {
        if (result.kind === "conflict") {
          await onConflict(result.conflict);
          return;
        }
        throw new Error(result.kind === "error" ? result.message : result.kind);
      }
      onMutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusyBranch(null);
    }
  }

  /**
   * POST one /branches action for the rail's context menu. Mirrors the
   * Branches tab's act(): conflict → AI dialog, hook failure → dialog,
   * success → labelled toast + workspace refresh.
   */
  async function run(action: string, extra?: Record<string, unknown>) {
    if (busyBranch) return;
    setBusyBranch(String(extra?.branch ?? action));
    try {
      const result = await postGitAction<{
        alreadyUpToDate?: boolean;
        message?: string;
        backupBranch?: string | null;
      }>(repoApi(repoName, "/branches"), { action, ...extra });
      if (!result.ok) {
        if (result.kind === "conflict") {
          await onConflict(result.conflict);
          return;
        }
        if (result.kind === "hook") {
          onHookFailure(result.hook);
          return;
        }
        throw new Error(result.message);
      }
      const label = (extra?.newBranch ?? extra?.branch) as unknown;
      if (result.json.alreadyUpToDate) {
        toast.success(result.json.message || "Already up to date.");
      } else {
        toast.success(
          BRANCH_ACTION_SUCCESS_LABELS[action]?.(label) ?? result.json.message ?? "Done",
        );
      }
      if (result.json.backupBranch) {
        toast.info(`Backup branch: ${result.json.backupBranch}`, { duration: 9000 });
      }
      onMutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyBranch(null);
    }
  }

  /** Same menu as the Branches tab — one builder, two surfaces, no drift. */
  const railMenuGroupsMemo = useMemo(() => {
    const t = branchMenu.target;
    if (!t) return [];
    return buildBranchMenuGroups(
      t,
      {
        currentBranch: summary?.currentBranch ?? t.name,
        mainBranch: summary?.mainBranch ?? null,
        defaultRemote: summary?.defaultRemote ?? "origin",
        remoteWebUrl: summary?.remoteWebUrl ?? null,
        busy: busyBranch !== null,
        pushing,
        dirty: (summary?.staged ?? 0) + (summary?.unstaged ?? 0) > 0,
        currentUpstream: summary?.upstream ?? null,
        currentAhead: summary?.ahead ?? 0,
        currentBehind: summary?.behind ?? 0,
      },
      {
        confirm,
        prompt,
        toast,
        run,
        checkout: (name) => void checkout(name),
        checkoutRemote: (target) => void checkoutRemote(target.name),
        onPush,
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- actions are stable closures recreated per open
  }, [branchMenu.target, summary, busyBranch, pushing]);

  /** Right-click opens the branch menu. Returns the handler directly so the
   *  JSX site's contextual type applies (a typed object literal trips
   *  strictFunctionTypes against MouseEventHandler). */
  function railMenuBind(target: BranchMenuTarget) {
    return (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      branchMenu.openAtPoint(event.clientX, event.clientY, target);
    };
  }

  async function checkoutRemote(remoteRef: string) {
    const suggested = remoteRef.replace(/^[^/]+\//, "");
    if (busyBranch) return;
    if (!canCheckout(suggested)) return;
    setBusyBranch(remoteRef);
    try {
      let result = await postGitAction<{ branch?: string }>(repoApi(repoName, "/branches"), {
        action: "checkout-remote",
        branch: remoteRef,
        newBranch: suggested,
      });
      if (!result.ok && result.kind === "checkout-conflict") {
        const strategy = await chooseCheckoutStrategy(decide, result.conflict);
        if (!strategy) return;
        result = await postGitAction<{ branch?: string }>(repoApi(repoName, "/branches"), {
          action: "checkout-remote",
          branch: remoteRef,
          newBranch: suggested,
          strategy,
        });
      }
      if (!result.ok) {
        if (result.kind === "conflict") {
          await onConflict(result.conflict);
          return;
        }
        throw new Error(result.kind === "error" ? result.message : result.kind);
      }
      toast.success(`Checked out ${suggested}`);
      onMutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusyBranch(null);
    }
  }

  return (
    <aside className="repo-git-rail" aria-label="Repository overview">
      <div className="repo-git-rail-section">
        <SectionHeader
          label="Branches"
          count={localBranches.length}
          open={branchesOpen}
          onToggle={() => setBranchesOpen((v) => !v)}
        />
        {branchesOpen && (summary ? localBranches : []).map((b) => {
          const ahead = b.current ? summary!.ahead : b.ahead ?? 0;
          const behind = b.current ? summary!.behind : b.behind ?? 0;
          const gone = b.upstreamGone;
          // Every "ahead" commit already lives on this other remote ref —
          // the count is trivia, not a push queue. Demote it to a ✓.
          const pushedVia = b.pushedElsewhereRef;
          const aheadLabel =
            ahead > 0 && pushedVia ? `↑${ahead}✓` : ahead > 0 ? `↑${ahead}` : null;
          const pushedTitle = pushedVia
            ? `All ${ahead} ahead commit${ahead === 1 ? "" : "s"} already on ${pushedVia} — nothing to push`
            : undefined;
          const pr = prsByBranch[b.name];
          return (
            <button
              key={b.name}
              type="button"
              className="repo-git-rail-branch"
              data-current={b.current || undefined}
              data-stale={b.staleDays !== undefined || undefined}
              disabled={Boolean(busyBranch) && busyBranch !== b.name}
              title={
                b.current
                  ? `${b.name} — checked out`
                  : gone
                    ? `${b.name} — upstream is gone`
                    : pushedTitle
                      ? `${b.name} — ${pushedTitle}`
                      : b.worktreePath
                        ? `${b.name} — checked out in another worktree (${b.worktreePath})`
                        : b.staleDays !== undefined
                          ? `${b.name} — last commit ${b.staleDays}d ago · Check out (right-click for more)`
                          : `Double-click to check out ${b.name} (right-click for more)`
              }
              onDoubleClick={() => void checkout(b.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void checkout(b.name);
              }}
              onContextMenu={railMenuBind({
                name: b.name,
                current: b.current,
                upstream: b.upstream,
                ahead: b.ahead,
                behind: b.behind,
                upstreamGone: b.upstreamGone,
                prUrl: prsByBranch[b.name]?.url,
              })}
              data-drop-branch={b.current ? undefined : b.name}
            >
              <span className="truncate font-mono">{b.name}</span>
              {pr && (
                <span
                  className="repo-git-rail-pr"
                  data-checks={pr.checks}
                  title={`PR #${pr.number}: ${pr.title} · checks ${pr.checks} — click to open`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void openInBrowser(pr.url);
                  }}
                >
                  #{pr.number}
                </span>
              )}
              <span className="repo-git-rail-counts" aria-label="Ahead and behind upstream">
                {gone && <span data-dir="gone" title={`Upstream ${b.upstream ?? ""} was deleted on the remote`.trim()}>⌫</span>}
                {aheadLabel && (
                  <span
                    data-dir={pushedVia ? "pushed" : "ahead"}
                    title={
                      pushedTitle ??
                      `${ahead} commit${ahead === 1 ? "" : "s"} ahead of ${b.upstream ?? "upstream"}${b.current ? " — right-click to push" : ""}`
                    }
                  >
                    {aheadLabel}
                  </span>
                )}
                {behind > 0 && (
                  <span
                    data-dir="behind"
                    title={`${behind} commit${behind === 1 ? "" : "s"} behind ${b.upstream ?? "upstream"}${b.current ? " — right-click to pull" : " — check out to pull"}`}
                  >
                    ↓{behind}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {!summary && <div className="repo-git-empty-sm">Loading…</div>}
      </div>

      {remoteOnly.length > 0 && (
        <div className="repo-git-rail-section">
          <SectionHeader
            label="Remotes"
            count={remoteOnly.length}
            open={remotesOpen}
            onToggle={() => setRemotesOpen((v) => !v)}
          />
          {remotesOpen &&
            remoteOnly.map((r) => (
              <button
                key={r.name}
                type="button"
                className="repo-git-rail-branch"
                disabled={busyBranch !== null}
                title={`Double-click to create local ${r.localName} tracking this branch`}
                onDoubleClick={() => void checkoutRemote(r.name)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void checkoutRemote(r.name);
                }}
                onContextMenu={railMenuBind({
                  name: r.name,
                  current: false,
                  remote: true,
                  localName: r.localName,
                  trackedLocalName: r.trackedLocalName,
                  prUrl:
                    prsByBranch[r.name]?.url ??
                    prsByBranch[r.name.replace(/^[^/]+\//, "")]?.url,
                })}
              >
                <span className="truncate font-mono">{r.name}</span>
              </button>
            ))}
        </div>
      )}

      <div className="repo-git-rail-section">
        <SectionHeader
          label="Stashes"
          count={summary?.stashes ?? 0}
          open={stashOpen}
          onToggle={() => setStashOpen((v) => !v)}
          icon={<Layers size={10} aria-hidden />}
        />
        {stashOpen && (summary?.stashes ?? 0) > 0 && (
          <button
            type="button"
            className="repo-git-rail-branch"
            onClick={() => onOpenTab("stash")}
          >
            Open stash list
          </button>
        )}
      </div>

      {(summary?.tags.length ?? 0) > 0 && (
        <div className="repo-git-rail-section repo-git-rail-tags">
          <SectionHeader
            label="Tags"
            count={summary!.tags.length}
            open={tagsOpen}
            onToggle={() => setTagsOpen((v) => !v)}
            icon={<Tag size={10} aria-hidden />}
          />
          {tagsOpen &&
            summary!.tags.slice(0, 12).map((t) => (
              <span key={t} className="repo-git-rail-tag font-mono truncate" title={t}>
                {t}
              </span>
            ))}
        </div>
      )}
      <ContextMenu
        open={Boolean(branchMenu.target)}
        position={branchMenu.position}
        groups={railMenuGroupsMemo}
        onClose={branchMenu.close}
        label={branchMenu.target ? `Actions for ${branchMenu.target.name}` : "Branch actions"}
      />
    </aside>
  );
}
