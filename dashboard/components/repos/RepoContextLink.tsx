"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleAlert, FolderGit2, RefreshCw } from "lucide-react";
import { useReposActions } from "@/app/repos/useReposActions";
import type { RepoInfo } from "@/app/repos/types";
import { ContextMenu, useContextMenu, type ContextMenuPosition, type ContextMenuGroup } from "@/components/shell/ContextMenu";
import { isDesktop } from "@/lib/desktop/bridge";
import { parseRepoFullNameFromRemote } from "@/lib/github/repo-url";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { buildLocalRepoMenuGroups } from "./local-repo-menu";

function RepoLinkMenu({ name, open, position, onClose }: {
  name: string; open: boolean; position: ContextMenuPosition | null; onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const repo = useLive<{ repo: RepoInfo }>(`/api/repos/${encodeURIComponent(name)}`, { shouldRetryOnError: false });
  const apps = useLive<{ gitkraken: boolean; revealLabel?: string }>("/api/repos/apps");
  const actions = useReposActions({ mutateLocal: () => repo.mutate(), mutateGithub: async () => undefined });
  const fullName = parseRepoFullNameFromRemote(repo.data?.repo.remote ?? null);
  const groups: ContextMenuGroup[] = repo.data ? buildLocalRepoMenuGroups({
    target: repo.data.repo, apps: apps.data, isDesktop: isDesktop(), opening: actions.opening,
    busy: actions.opening !== null, githubUrl: fullName ? `https://github.com/${fullName}` : null,
    onCursor: actions.openInCursor, onTerminal: actions.openInTerminal,
    onRevealFolder: actions.openInFolder, onGitKraken: actions.openInGitKraken, toast,
  }) : [{
    id: "repo",
    items: [
      { id: "open", label: "Open repository", icon: <FolderGit2 size={12} aria-hidden />, onSelect: () => router.push(`/repos/${encodeURIComponent(name)}`) },
      { id: "loading", label: repo.error ? "Couldn't load repo actions" : "Loading repo actions…", icon: repo.error ? <CircleAlert size={12} aria-hidden /> : <FolderGit2 size={12} aria-hidden />, disabled: true, onSelect: () => undefined },
      ...(repo.error ? [{ id: "retry", label: "Retry", icon: <RefreshCw size={12} aria-hidden />, onSelect: () => void repo.mutate() }] : []),
    ],
  }];
  return <ContextMenu open={open} position={position} groups={groups} onClose={onClose} label={`${name} repository actions`} />;
}

export function RepoContextLink({ name }: { name: string }) {
  const menu = useContextMenu<string>();
  const [opened, setOpened] = useState(false);
  const openAt = (x: number, y: number, host: HTMLElement) => {
    setOpened(true);
    menu.openAtPoint(x, y, name, host);
  };
  return <>
    <Link href={`/repos/${encodeURIComponent(name)}`} data-entity-chip="" data-kind="repo"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault(); event.stopPropagation();
        openAt(event.clientX, event.clientY, event.currentTarget);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        openAt(rect.left + 12, rect.bottom - 4, event.currentTarget);
      }}
    >{name}</Link>
    {opened ? <RepoLinkMenu name={name} open={menu.target !== null} position={menu.position} onClose={menu.close} /> : null}
  </>;
}
