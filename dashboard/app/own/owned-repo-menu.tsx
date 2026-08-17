"use client";

import {
  BookOpen,
  Brain,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  History,
  MonitorPlay,
  Rocket,
  ScanSearch,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { ContextMenuGroup, ContextMenuItem } from "@/components/shell/ContextMenu";
import type { ResolvedOwnedRepo } from "@/lib/ownership/types";

export const OWNED_REPO_CLONE_FIRST = "Clone this repo first";

export function ownedRepoHref(fullName: string): string {
  const [owner, name] = fullName.split("/");
  return `/own/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}`;
}

export function ownedRepoGapsHref(fullName: string): string {
  return `${ownedRepoHref(fullName)}#gaps`;
}

export function ownedRepoCatchUpHref(fullName: string): string {
  return `${ownedRepoHref(fullName)}#catch-up`;
}

export function ownedRepoLearnHref(repo: ResolvedOwnedRepo): string {
  return `/repos/learn/${encodeURIComponent(repo.localRepoName ?? repo.name)}`;
}

export function ownedRepoCloneUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith(".git") ? trimmed : `${trimmed}.git`;
}

export function ownedRepoPullsUrl(url: string): string {
  return `${url.replace(/\/+$/, "")}/pulls`;
}

export interface OwnedRepoMenuActions {
  onOpenCursor: () => void;
  onOpenGitWorkspace: () => void;
  onOpenGithub: () => void;
  onOpenRadar: () => void;
  onOpenCatchUp: () => void;
  onOpenPrs: () => void;
  onCopyCloneUrl: () => void;
  onCopyFullName: () => void;
  onReveal: () => void;
  onUpstart: () => void;
  onClone: () => void;
  onLearn: () => void;
  onKnowledgeGaps: () => void;
  onScopeCreep: () => void;
  onStopOwning: () => void;
}

export interface OwnedRepoMenuInput {
  repo: ResolvedOwnedRepo;
  revealLabel: string;
  busy: boolean;
  opening: boolean;
  cloning: boolean;
  hasUpstart: boolean;
}

function cloneGate(cloned: boolean, extra = false): Pick<ContextMenuItem, "disabled" | "disabledReason"> {
  if (!cloned) return { disabled: true, disabledReason: OWNED_REPO_CLONE_FIRST };
  if (extra) return { disabled: true };
  return {};
}

export function buildOwnedRepoMenuGroups(
  input: OwnedRepoMenuInput,
  actions: OwnedRepoMenuActions,
): ContextMenuGroup[] {
  const cloned = Boolean(input.repo.localPath && input.repo.localRepoName);
  const cursorGate = cloneGate(cloned, input.opening || input.busy);

  return [
    {
      id: "open",
      label: "Open",
      items: [
        {
          id: "cursor",
          label: input.opening ? "Opening in Cursor…" : "Open in Cursor",
          icon: <MonitorPlay size={12} />,
          ...cursorGate,
          onSelect: actions.onOpenCursor,
        },
        {
          id: "git",
          label: "Open git workspace",
          icon: <GitBranch size={12} />,
          ...cloneGate(cloned),
          onSelect: actions.onOpenGitWorkspace,
        },
        {
          id: "github",
          label: "Open on GitHub",
          icon: <ExternalLink size={12} />,
          onSelect: actions.onOpenGithub,
        },
        {
          id: "radar",
          label: "Open ownership radar",
          icon: <ShieldCheck size={12} />,
          onSelect: actions.onOpenRadar,
        },
      ],
    },
    {
      id: "work",
      label: "Work",
      items: [
        {
          id: "prs",
          label: "Open PRs",
          description: "GitHub pull requests",
          icon: <GitPullRequest size={12} />,
          onSelect: actions.onOpenPrs,
        },
        {
          id: "copy-clone",
          label: "Copy clone URL",
          icon: <Copy size={12} />,
          onSelect: actions.onCopyCloneUrl,
        },
        {
          id: "copy-name",
          label: "Copy owner/name",
          icon: <Copy size={12} />,
          onSelect: actions.onCopyFullName,
        },
        {
          id: "reveal",
          label: input.revealLabel,
          icon: <FolderOpen size={12} />,
          ...cloneGate(cloned),
          onSelect: actions.onReveal,
        },
        {
          id: "upstart",
          label: cloned && !input.hasUpstart ? "Create and run upstart" : "Run upstart",
          icon: <Rocket size={12} />,
          ...cloneGate(cloned),
          onSelect: actions.onUpstart,
        },
        ...(cloned
          ? []
          : [
              {
                id: "clone",
                label: input.cloning ? "Cloning…" : "Clone",
                icon: <Download size={12} />,
                disabled: input.cloning || input.busy,
                onSelect: actions.onClone,
              } satisfies ContextMenuItem,
            ]),
      ],
    },
    {
      id: "own",
      label: "Ownership",
      items: [
        {
          id: "learn",
          label: "Learn this repo",
          description: "Architecture, gotchas, how to run it",
          icon: <Brain size={12} />,
          ...cloneGate(cloned),
          onSelect: actions.onLearn,
        },
        {
          id: "catch-up",
          label: "Catch up since last look",
          icon: <History size={12} />,
          onSelect: actions.onOpenCatchUp,
        },
        {
          id: "gaps",
          label: "Knowledge gaps",
          icon: <BookOpen size={12} />,
          onSelect: actions.onKnowledgeGaps,
        },
        {
          id: "scope",
          label: "Scope creep",
          icon: <ScanSearch size={12} />,
          ...cloneGate(cloned),
          onSelect: actions.onScopeCreep,
        },
        {
          id: "remove",
          label: "Stop owning",
          icon: <Trash2 size={12} />,
          danger: true,
          disabled: input.busy,
          onSelect: actions.onStopOwning,
        },
      ],
    },
  ];
}
