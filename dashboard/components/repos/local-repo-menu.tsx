"use client";

import { Bot, Copy, ExternalLink, FolderOpen, GitBranch, MonitorPlay, TerminalSquare } from "lucide-react";
import type { RepoInfo } from "@/app/repos/types";
import type { ContextMenuGroup } from "@/components/shell/ContextMenu";
import { openAgentHandoff } from "@/lib/agent-handoff";
import { copyTextToClipboard } from "@/lib/clipboard";
import { openInBrowser } from "@/lib/desktop/bridge";
import type { useToast } from "@/lib/hooks/use-toast";

/** The repo card's Open group, shared with compact repo links. */
export function buildLocalRepoMenuGroups({
  target, apps, isDesktop, opening, busy, githubUrl, onCursor, onTerminal, onRevealFolder, onGitKraken, toast,
}: {
  target: RepoInfo;
  apps?: { gitkraken: boolean; revealLabel?: string };
  isDesktop: boolean;
  opening: string | null;
  busy: boolean;
  githubUrl: string | null;
  onCursor: (name: string) => void;
  onTerminal: (repo: RepoInfo) => void;
  onRevealFolder: (name: string) => void;
  onGitKraken: (name: string) => void;
  toast: ReturnType<typeof useToast>;
}): ContextMenuGroup[] {
  const openGroup: ContextMenuGroup = {
      id: "open",
      label: "Open",
      items: [
        ...(isDesktop
          ? [
              {
                id: "cursor",
                label: opening === target.name ? "Opening in Cursor…" : "Open in Cursor",
                icon: <MonitorPlay size={12} />,
                disabled: busy,
                onSelect: () => onCursor(target.name),
              },
              {
                id: "terminal",
                label: "Terminal",
                icon: <TerminalSquare size={12} />,
                onSelect: () => onTerminal(target),
              },
            ]
          : []),
        {
          id: "folder",
          label: apps?.revealLabel ?? "Show folder",
          icon: <FolderOpen size={12} />,
          onSelect: () => onRevealFolder(target.name),
        },
        ...(githubUrl
          ? [
              {
                id: "github",
                label: "Open on GitHub",
                icon: <ExternalLink size={12} />,
                onSelect: () => void openInBrowser(githubUrl),
              },
            ]
          : []),
        {
          id: "copy-path",
          label: "Copy path",
          icon: <Copy size={12} />,
          onSelect: () =>
            void copyTextToClipboard(target.path).then(
              () => toast.success("Path copied"),
              () => toast.error("Could not copy path"),
            ),
        },
        { id: "agents", label: "Ask Agent", icon: <Bot size={12} />, onSelect: () => openAgentHandoff({ title: "Ask Agent · " + target.name, cwd: target.path, repoName: target.name, worktree: false }) },
        ...(isDesktop && apps?.gitkraken
          ? [
              {
                id: "gitkraken",
                label: "GitKraken",
                icon: <GitBranch size={12} />,
                onSelect: () => onGitKraken(target.name),
              },
            ]
          : []),
      ],
    };
  return [
    { ...openGroup, items: openGroup.items.filter((item) => !["agents", "copy-path"].includes(item.id)) },
    { id: "agent", label: "Agent", items: openGroup.items.filter((item) => item.id === "agents") },
    { id: "copy", label: "Copy", items: openGroup.items.filter((item) => item.id === "copy-path") },
  ];
}
