"use client";

import {
  Copy,
  GitBranch,
  GitCommitHorizontal,
  LogOut,
  Rewind,
  RotateCcw,
  ScanSearch,
  Share2,
  Tag,
} from "lucide-react";
import type { ContextMenuGroup } from "@/components/shell/ContextMenu";
import type { GraphLaneCommit } from "@/lib/repos/git-graph";

export interface CommitMenuCallbacks {
  busy: boolean;
  confirmCommitAction: (
    action: string,
    commit: GraphLaneCommit,
    title: string,
    message: string,
    confirmLabel: string,
  ) => Promise<void>;
  prompt: (opts: {
    title: string;
    message: string;
    input: { placeholder: string };
    confirmLabel: string;
  }) => Promise<string | null | undefined | false>;
  runCommitAction: (action: string, commit: GraphLaneCommit, name?: string) => Promise<void>;
  onCopySha: (commit: GraphLaneCommit) => void;
  onCopyMessage: (commit: GraphLaneCommit) => void;
  onSharePatch: (commit: GraphLaneCommit) => void;
  onReview: (commit: GraphLaneCommit) => void;
}

export function buildCommitMenuGroups(
  commit: GraphLaneCommit | null,
  cb: CommitMenuCallbacks,
): ContextMenuGroup[] {
  if (!commit) return [];
  const busy = cb.busy;
  const isHead = commit.refs.some((ref) => /^HEAD(?: ->|$)/.test(ref));
  const isMerge = commit.parentLanes.length > 1;
  const mergeReason = isMerge ? "Merge commits need a mainline parent" : undefined;

  return [
    {
      id: "apply",
      label: "Apply",
      items: [
        {
          id: "cherry-pick",
          label: "Cherry-pick",
          description: "Apply this commit to the current branch",
          icon: <GitCommitHorizontal size={12} />,
          disabled: busy || isHead || isMerge,
          disabledReason: isHead ? "Already at HEAD" : mergeReason,
          onSelect: () =>
            void cb.confirmCommitAction(
              "cherry-pick",
              commit,
              `Cherry-pick ${commit.shortHash}?`,
              `Applies “${commit.subject}” to the current branch. Conflicts open in the Conflicts tab.`,
              "Cherry-pick",
            ),
        },
        {
          id: "revert",
          label: "Revert",
          description: "Create a new commit that undoes this one",
          icon: <RotateCcw size={12} />,
          disabled: busy || isMerge,
          disabledReason: mergeReason,
          onSelect: () =>
            void cb.confirmCommitAction(
              "revert",
              commit,
              `Revert ${commit.shortHash}?`,
              `Creates a new commit that reverses “${commit.subject}”. Existing history is not rewritten.`,
              "Revert",
            ),
        },
      ],
    },
    {
      id: "create",
      label: "Create",
      items: [
        {
          id: "branch",
          label: "New branch from here…",
          icon: <GitBranch size={12} />,
          disabled: busy,
          onSelect: () =>
            void (async () => {
              const name = await cb.prompt({
                title: `New branch from ${commit.shortHash}`,
                message: commit.subject,
                input: { placeholder: "feature/my-work" },
                confirmLabel: "Create",
              });
              if (typeof name === "string" && name.trim()) {
                await cb.runCommitAction("branch-from-commit", commit, name.trim());
              }
            })(),
        },
        {
          id: "tag",
          label: "Create tag…",
          icon: <Tag size={12} />,
          disabled: busy,
          onSelect: () =>
            void (async () => {
              const name = await cb.prompt({
                title: `Tag ${commit.shortHash}`,
                message: commit.subject,
                input: { placeholder: "v1.2.3" },
                confirmLabel: "Create tag",
              });
              if (typeof name === "string" && name.trim()) {
                await cb.runCommitAction("tag", commit, name.trim());
              }
            })(),
        },
      ],
    },
    {
      id: "move",
      label: "Move HEAD",
      items: [
        {
          id: "checkout-detached",
          label: "Check out detached",
          description: "Inspect this revision without moving a branch",
          icon: <LogOut size={12} />,
          disabled: busy || isHead,
          disabledReason: isHead ? "Already at HEAD" : undefined,
          onSelect: () =>
            void cb.confirmCommitAction(
              "checkout-detached",
              commit,
              `Check out ${commit.shortHash} detached?`,
              "HEAD will point directly at this commit. Create or check out a branch before committing new work.",
              "Check out",
            ),
        },
        {
          id: "reset",
          label: "Reset current branch to here",
          description: "Hard reset; DevHub creates a backup branch first",
          icon: <Rewind size={12} />,
          danger: true,
          disabled: busy || isHead,
          disabledReason: isHead ? "Already at HEAD" : undefined,
          onSelect: () =>
            void cb.confirmCommitAction(
              "reset-to-commit",
              commit,
              `Reset to ${commit.shortHash}?`,
              "Moves the current branch here with git reset --hard. Requires a clean tree and creates a backup branch first.",
              "Hard reset",
            ),
        },
      ],
    },
    {
      id: "copy",
      items: [
        {
          id: "copy-sha",
          label: "Copy SHA",
          icon: <Copy size={12} />,
          onSelect: () => cb.onCopySha(commit),
        },
        {
          id: "copy-message",
          label: "Copy commit message",
          icon: <Copy size={12} />,
          onSelect: () => cb.onCopyMessage(commit),
        },
        {
          id: "share-patch",
          label: "Share this diff for 24h",
          description: "One-time PrivateBin link, burn after reading",
          icon: <Share2 size={12} />,
          onSelect: () => cb.onSharePatch(commit),
        },
        {
          id: "review",
          label: "Review this commit",
          description: "Write reviews/<repo>-<date> with a Repo entity link",
          icon: <ScanSearch size={12} />,
          onSelect: () => cb.onReview(commit),
        },
      ],
    },
  ];
}
