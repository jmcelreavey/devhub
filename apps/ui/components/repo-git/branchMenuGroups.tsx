import {
  ArrowDownToLine,
  Copy,
  CornerDownLeft,
  ExternalLink,
  GitBranch,
  GitCompare,
  GitMerge,
  Link2,
  Pencil,
  Rewind,
  Trash2,
  Upload,
} from "lucide-react";
import type { ContextMenuGroup } from "@/components/shell/ContextMenu";
import { copyTextToClipboard } from "@/lib/clipboard";
import { openInBrowser } from "@/lib/desktop/bridge";

/** Success toasts, keyed by the POSTed action — shared by every branch surface. */
export const BRANCH_ACTION_SUCCESS_LABELS: Record<string, (branch?: unknown) => string> = {
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
  "pull-rebase": () => "Pulled with rebase",
  "pull-merge": () => "Pulled with merge",
  "prune-backup-branches": () => "Pruned backup branches",
};

/**
 * One branch row, local or remote-tracking. The Branches tab passes BranchInfo
 * fields; the Git rail passes its RailSummary branch fields plus the lazily
 * fetched PR url. `remote: true` swaps the full local menu for the short
 * remote-tracking one.
 */
export interface BranchMenuTarget {
  name: string;
  current: boolean;
  remote?: boolean;
  /** Remote refs only: the suggested local branch name (`origin/foo` → `foo`). */
  localName?: string;
  trackedLocalName?: string | null;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  upstreamGone?: boolean;
  /** Existing PR for this branch (rail only) — preferred over the compare URL. */
  prUrl?: string;
}

/** Repo-level state the menu's enablement logic reads. */
export interface BranchMenuState {
  currentBranch: string;
  mainBranch: string | null;
  defaultRemote: string;
  remoteWebUrl: string | null;
  /** A branch action is already running — disable the menu rather than queue. */
  busy: boolean;
  pushing: boolean;
  dirty: boolean;
  /** Current branch's upstream + ahead/behind — pull/push enablement. */
  currentUpstream: string | null;
  currentAhead: number;
  currentBehind: number;
}

export interface BranchMenuCallbacks {
  confirm: (opts: {
    title: string;
    message?: string;
    confirmLabel?: string;
    variant?: "default" | "danger";
  }) => Promise<boolean>;
  prompt: (opts: {
    title: string;
    message?: string;
    input: { placeholder: string; defaultValue?: string };
    confirmLabel: string;
  }) => Promise<string | null>;
  toast: {
    success: (message: string, opts?: { duration?: number }) => void;
    error: (message: string, opts?: { duration?: number }) => void;
    info: (message: string, opts?: { duration?: number }) => void;
  };
  /** POST one /branches action; the caller owns conflict/hook handling, toasts and refresh. */
  run: (action: string, extra?: Record<string, unknown>) => Promise<boolean | void>;
  /** Checkout keeps a surface-specific confirm (the rail warns about worktrees/conflicts). */
  checkout: (branch: string) => void;
  /** Remote refs only: create/switch to the local branch tracking this ref. */
  checkoutRemote: (target: BranchMenuTarget) => void;
  /** Workspace-level push (owns the pushing state and pre-push hooks). */
  onPush: () => void;
  /** Optional — surfaces without a compare modal omit the item. */
  onCompare?: (branch: string) => void;
}

/**
 * The right-click menu for a branch row, shared by the Branches tab and the
 * Git workspace rail so the two never drift. Actions the branch cannot support
 * are shown disabled with the reason rather than hidden — a menu whose shape
 * changes per row is harder to learn than one where the same item is greyed out.
 */
export function buildBranchMenuGroups(
  target: BranchMenuTarget,
  state: BranchMenuState,
  cb: BranchMenuCallbacks,
): ContextMenuGroup[] {
  const { confirm, prompt, toast, run } = cb;

  async function copyName(name: string) {
    try {
      await copyTextToClipboard(name);
      toast.success("Branch name copied");
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  }

  if (target.remote) {
    return [
      {
        id: "move",
        items: [
          {
            id: "checkout",
            label: target.trackedLocalName
              ? `Check out ${target.trackedLocalName}`
              : `Check out as ${target.localName ?? target.name.replace(/^[^/]+\//, "")}`,
            description: "Creates a local branch tracking this remote branch",
            icon: <CornerDownLeft size={12} />,
            disabled: state.busy,
            onSelect: () =>
              target.trackedLocalName
                ? cb.checkout(target.trackedLocalName)
                : cb.checkoutRemote(target),
          },
          ...(cb.onCompare
            ? [
                {
                  id: "compare",
                  label: `Compare with ${state.currentBranch}`,
                  icon: <GitCompare size={12} />,
                  onSelect: () => cb.onCompare?.(target.name),
                },
              ]
            : []),
        ],
      },
      {
        id: "copy",
        items: [
          {
            id: "copy",
            label: "Copy name",
            icon: <Copy size={12} />,
            onSelect: () => void copyName(target.name),
          },
          {
            id: "github",
            label: "Open on GitHub",
            icon: <ExternalLink size={12} />,
            disabled: !state.remoteWebUrl,
            disabledReason: state.remoteWebUrl ? undefined : "No browsable origin remote",
            onSelect: () =>
              void openInBrowser(
                `${state.remoteWebUrl}/tree/${encodeURIComponent(target.localName ?? target.name)}`,
              ),
          },
        ],
      },
    ];
  }

  const current = state.currentBranch;
  const isCurrent = target.current;
  const busy = state.busy;
  const hasRemote = Boolean(state.remoteWebUrl);
  const dirty = state.dirty;
  const upstream = state.currentUpstream;
  const behind = state.currentBehind;
  const ahead = state.currentAhead;
  const defaultRemote = state.defaultRemote;

  async function mergeIntoCurrent() {
    const ok = await confirm({
      title: `Merge ${target.name} into ${current}?`,
      message: `Runs git merge --no-edit ${target.name} on ${current}. Conflicts open in the Conflicts tab; nothing is pushed.`,
      confirmLabel: "Merge",
    });
    if (ok) await run("merge-branch", { branch: target.name });
  }

  async function rebaseOnto() {
    const ok = await confirm({
      title: `Rebase ${current} onto ${target.name}?`,
      message: `Replays every commit on ${current} on top of ${target.name}, rewriting their hashes. DevHub takes a backup branch first and aborts the rebase if anything conflicts.`,
      confirmLabel: "Rebase",
      variant: "danger",
    });
    if (ok) await run("rebase-branch", { branch: target.name });
  }

  async function pullWith(action: "pull-rebase" | "pull-merge") {
    const ok = await confirm({
      title: action === "pull-rebase" ? "Pull with rebase?" : "Pull with merge?",
      message:
        action === "pull-rebase"
          ? "git pull --rebase. Replays your local commits on top of upstream. No merge commit. Conflicts open in the Conflicts tab."
          : "git pull --no-rebase. Merges upstream into this branch. Conflicts open in the Conflicts tab.",
      confirmLabel: action === "pull-rebase" ? "Rebase pull" : "Merge pull",
      variant: action === "pull-rebase" ? "danger" : undefined,
    });
    if (ok) await run(action);
  }

  async function branchFrom() {
    const name = await prompt({
      title: `New branch from ${target.name}`,
      message: `Creates a branch at ${target.name}'s tip. Your checkout does not move.`,
      input: { placeholder: "feature/my-work" },
      confirmLabel: "Create",
    });
    if (!name?.trim()) return;
    await run("branch-from", { branch: target.name, newBranch: name.trim() });
  }

  async function renameBranch() {
    const name = await prompt({
      title: `Rename ${target.name}`,
      message:
        "Renames the local branch only. If it already tracks a remote branch, the remote name stays as it was.",
      input: { placeholder: target.name, defaultValue: target.name },
      confirmLabel: "Rename",
    });
    if (!name?.trim() || name.trim() === target.name) return;
    await run("rename-branch", { branch: target.name, newBranch: name.trim() });
  }

  async function resetCurrentTo(mode: "soft" | "mixed" | "hard") {
    const copy =
      mode === "soft"
        ? `Moves ${current} to ${target.name} with git reset --soft: HEAD moves, index and working tree stay. Creates a backup branch first.`
        : mode === "mixed"
          ? `Moves ${current} to ${target.name} with git reset --mixed: HEAD and index move, working tree stays. Creates a backup branch first.`
          : `Moves ${current} to ${target.name} with git reset --hard: commits only on ${current} stop being reachable by name, and the working tree is replaced. Requires a clean tree; DevHub takes a backup branch first.`;
    const ok = await confirm({
      title: `${mode === "hard" ? "Hard" : mode === "soft" ? "Soft" : "Mixed"} reset ${current} to ${target.name}?`,
      message: copy,
      confirmLabel: `${mode[0]!.toUpperCase()}${mode.slice(1)} reset`,
      variant: "danger",
    });
    if (ok) await run("reset-to-branch", { branch: target.name, mode });
  }

  async function deleteBranch(force: boolean) {
    const ok = await confirm(
      force
        ? {
            title: `Force-delete ${target.name}?`,
            message:
              "git branch -D. Commits only on this branch are no longer reachable by name — recoverable from the reflog for a while, then gone.",
            confirmLabel: "Force delete",
            variant: "danger",
          }
        : {
            title: `Delete branch ${target.name}?`,
            message:
              "Uses git branch -d (safe delete) — git refuses if the branch has unmerged work.",
            confirmLabel: "Delete",
            variant: "danger",
          },
    );
    if (!ok) return;
    await run("delete-branch", { branch: target.name, ...(force ? { force: true } : {}) });
  }

  async function forcePushWithLease() {
    const ok = await confirm({
      title: "Force-push rewritten history?",
      message:
        "Uses git push --force-with-lease. The push is rejected if the remote changed since your last fetch.",
      confirmLabel: "Force-push with lease",
      variant: "danger",
    });
    if (ok) await run("force-push-with-lease");
  }

  const prItem = target.prUrl
    ? {
        id: "open-pr",
        label: "Open PR on GitHub",
        description: "The pull request this branch is attached to",
        icon: <ExternalLink size={12} />,
        onSelect: () => void openInBrowser(target.prUrl!),
      }
    : {
        id: "open-pr",
        label: "Open pull request",
        description: `Compare against ${state.mainBranch?.replace(/^origin\//, "") ?? "main"} on the web`,
        icon: <ExternalLink size={12} />,
        disabled: !hasRemote,
        disabledReason: !hasRemote ? "No browsable origin remote" : undefined,
        onSelect: () => {
          const main = state.mainBranch?.replace(/^origin\//, "") ?? "main";
          void openInBrowser(
            `${state.remoteWebUrl}/compare/${encodeURIComponent(main)}...${encodeURIComponent(target.name)}?expand=1`,
          );
        },
      };

  return [
    {
      id: "move",
      items: [
        {
          id: "checkout",
          label: `Check out ${target.name}`,
          description: dirty ? "Auto-stashes your changes first" : undefined,
          icon: <CornerDownLeft size={12} />,
          disabled: isCurrent || busy,
          disabledReason: isCurrent ? "Already checked out" : undefined,
          onSelect: () => cb.checkout(target.name),
        },
        {
          id: "merge",
          label: `Merge into ${current}`,
          description: `git merge ${target.name}`,
          icon: <GitMerge size={12} />,
          disabled: isCurrent || busy || dirty,
          disabledReason: isCurrent
            ? "That is the current branch"
            : dirty
              ? "Commit or stash your changes first"
              : undefined,
          onSelect: () => void mergeIntoCurrent(),
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
          onSelect: () => void rebaseOnto(),
        },
      ],
    },
    {
      id: "remote",
      label: "Remote",
      items: [
        {
          id: "push",
          label: `Push ${target.name}`,
          description: target.upstream
            ? `to ${target.upstream}`
            : "Sets the upstream to origin on first push",
          icon: <Upload size={12} />,
          disabled: !isCurrent || busy || state.pushing,
          disabledReason: !isCurrent ? "Check the branch out first" : undefined,
          onSelect: () => cb.onPush(),
        },
        {
          id: "pull",
          label: "Pull (fast-forward)",
          description: isCurrent ? "git pull --ff-only" : undefined,
          icon: <ArrowDownToLine size={12} />,
          disabled:
            !isCurrent || busy || !upstream || behind === 0 || (ahead > 0 && behind > 0),
          disabledReason: !isCurrent
            ? "Check the branch out to pull it"
            : !upstream
              ? "No upstream configured"
              : behind === 0
                ? "Already up to date"
                : ahead > 0 && behind > 0
                  ? "Diverged — use rebase or merge pull"
                  : undefined,
          onSelect: () => void run("pull"),
        },
        {
          id: "pull-rebase",
          label: "Pull with rebase",
          description: "git pull --rebase — replay local commits on upstream",
          icon: <CornerDownLeft size={12} />,
          disabled: !isCurrent || busy || !upstream || behind === 0,
          disabledReason: !isCurrent
            ? "Check the branch out to pull it"
            : !upstream
              ? "No upstream configured"
              : behind === 0
                ? "Already up to date"
                : undefined,
          onSelect: () => void pullWith("pull-rebase"),
        },
        {
          id: "pull-merge",
          label: "Pull with merge",
          description: "git pull --no-rebase — merge upstream into this branch",
          icon: <GitMerge size={12} />,
          disabled: !isCurrent || busy || !upstream || behind === 0,
          disabledReason: !isCurrent
            ? "Check the branch out to pull it"
            : !upstream
              ? "No upstream configured"
              : behind === 0
                ? "Already up to date"
                : undefined,
          onSelect: () => void pullWith("pull-merge"),
        },
        {
          id: "set-upstream",
          label: `Track ${defaultRemote}/${target.name}`,
          description: target.upstream ? `Currently ${target.upstream}` : undefined,
          icon: <Link2 size={12} />,
          disabled: busy || target.upstream === `${defaultRemote}/${target.name}`,
          disabledReason:
            target.upstream === `${defaultRemote}/${target.name}`
              ? "Already tracking it"
              : undefined,
          onSelect: () => void run("set-upstream", { branch: target.name, remote: defaultRemote }),
        },
        {
          id: "force-push-with-lease",
          label: "Force-push with lease",
          description: "Publish rebased history without overwriting newer remote work",
          icon: <Upload size={12} />,
          danger: true,
          disabled: !isCurrent || busy || !target.upstream,
          disabledReason: !isCurrent
            ? "Check the branch out first"
            : !target.upstream
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
        ...(cb.onCompare
          ? [
              {
                id: "compare",
                label: `Compare with ${current}`,
                description: "Diff this whole branch against your checkout",
                icon: <GitCompare size={12} />,
                disabled: isCurrent,
                disabledReason: isCurrent ? "That is the current branch" : undefined,
                onSelect: () => cb.onCompare?.(target.name),
              },
            ]
          : []),
        {
          id: "copy",
          label: "Copy branch name",
          icon: <Copy size={12} />,
          onSelect: () => void copyName(target.name),
        },
        prItem,
        {
          id: "open-web",
          label: "Open branch on the web",
          icon: <ExternalLink size={12} />,
          disabled: !hasRemote,
          disabledReason: !hasRemote ? "No browsable origin remote" : undefined,
          onSelect: () =>
            void openInBrowser(`${state.remoteWebUrl}/tree/${encodeURIComponent(target.name)}`),
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
          onSelect: () => void branchFrom(),
        },
        {
          id: "rename",
          label: "Rename…",
          icon: <Pencil size={12} />,
          disabled: busy,
          onSelect: () => void renameBranch(),
        },
        {
          id: "reset-soft",
          label: `Soft reset ${current} to here`,
          description: "Move HEAD only — keep index and working tree",
          icon: <Rewind size={12} />,
          danger: true,
          disabled: isCurrent || busy,
          disabledReason: isCurrent ? "That is the current branch" : undefined,
          onSelect: () => void resetCurrentTo("soft"),
        },
        {
          id: "reset-mixed",
          label: `Mixed reset ${current} to here`,
          description: "Move HEAD and index — keep working tree",
          icon: <Rewind size={12} />,
          danger: true,
          disabled: isCurrent || busy,
          disabledReason: isCurrent ? "That is the current branch" : undefined,
          onSelect: () => void resetCurrentTo("mixed"),
        },
        {
          id: "reset",
          label: `Hard reset ${current} to here`,
          description: "Replace working tree; discards commits only on the current branch",
          icon: <Rewind size={12} />,
          danger: true,
          disabled: isCurrent || busy || dirty,
          disabledReason: isCurrent
            ? "That is the current branch"
            : dirty
              ? "Commit or stash your changes first"
              : undefined,
          onSelect: () => void resetCurrentTo("hard"),
        },
        {
          id: "delete",
          label: "Delete",
          description: "git branch -d — refuses if unmerged",
          icon: <Trash2 size={12} />,
          danger: true,
          disabled: isCurrent || busy,
          disabledReason: isCurrent ? "Cannot delete the current branch" : undefined,
          onSelect: () => void deleteBranch(false),
        },
        {
          id: "force-delete",
          label: "Force delete",
          description: "git branch -D — drops unmerged commits",
          icon: <Trash2 size={12} />,
          danger: true,
          disabled: isCurrent || busy,
          disabledReason: isCurrent ? "Cannot delete the current branch" : undefined,
          onSelect: () => void deleteBranch(true),
        },
      ],
    },
  ];
}
