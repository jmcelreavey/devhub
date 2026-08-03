"use client";

import { ExternalLink } from "lucide-react";
import { LaunchMenu } from "@/components/shell/LaunchMenu";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { openRepoFileInCursor, openRepoInGitKraken } from "@/lib/open-in-cursor-client";

/**
 * "Open with" for a repo-relative file — Cursor (working tree or historical blob)
 * plus GitKraken when that app is available. Shared by Blame / History.
 */
export function RepoFileOpenMenu({
  repoName,
  filePath,
  commit,
  disabled = false,
}: {
  repoName: string;
  filePath: string;
  /** When set, Cursor opens a materialized blob at this revision. */
  commit?: string;
  disabled?: boolean;
}) {
  const toast = useToast();
  const { data: apps } = useLive<{ gitkraken?: boolean }>("/api/repos/apps", {
    revalidateOnFocus: false,
    refreshInterval: 0,
  });

  const trimmed = filePath.trim();
  if (!trimmed) return null;

  const items = [
    {
      id: "cursor",
      label: commit ? `Cursor · ${commit.slice(0, 7)}` : "Cursor",
      description: commit ? "Open this revision" : "Open working-tree file",
      onSelect: async () => {
        await openRepoFileInCursor(repoName, toast, trimmed, commit);
      },
    },
    ...(apps?.gitkraken
      ? [
          {
            id: "gitkraken",
            label: "GitKraken",
            description: "Open repository",
            onSelect: async () => {
              await openRepoInGitKraken(repoName, toast);
            },
          },
        ]
      : []),
  ];

  return (
    <LaunchMenu
      label="Open with"
      icon={<ExternalLink size={12} aria-hidden />}
      items={items}
      align="right"
      buttonClassName="btn btn-ghost"
      buttonStyle={{ fontSize: 11, gap: 4, padding: "3px 8px" }}
      disabled={disabled}
    />
  );
}
