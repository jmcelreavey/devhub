"use client";

import { useState } from "react";
import { useLaunchClaudeDesktop } from "@/lib/launch-claude";
import { useConfirm, usePrompt } from "@/components/ConfirmDialog";
import {
  agentRepoDxAuditCommand,
  agentRepoUpstartCommand,
  agentRepoUpstartDebugCommand,
  agentRepoUpstartUpdateCommand,
  openTerminal,
  repoUpstartCommand,
} from "@/lib/terminal-launch";
import { useToast } from "@/lib/use-toast";
import type { RepoInfo } from "./types";

/**
 * Imperative repo actions shared by the /repos list. Keeps clone/open/upstart/
 * remove handlers out of the page layout component.
 */
export function useReposActions(opts: {
  mutateLocal: () => Promise<unknown>;
  mutateGithub: () => Promise<unknown>;
}) {
  const { mutateLocal, mutateGithub } = opts;
  const [opening, setOpening] = useState<string | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const toast = useToast();
  const launchClaudeDesktop = useLaunchClaudeDesktop();
  const prompt = usePrompt();
  const confirm = useConfirm();

  async function openInCursor(name: string) {
    setOpening(name);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(name)}/open`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      console.error("open in cursor:", e);
      toast.error(`Couldn't open ${name} in Cursor.`);
    } finally {
      setOpening(null);
    }
  }

  function openInTerminal(repo: { name: string; path: string }) {
    openTerminal({ cwd: repo.path, label: repo.name });
  }

  async function openInGitKraken(name: string) {
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(name)}/open-gitkraken`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      console.error("open in gitkraken:", e);
      toast.error(`Couldn't open ${name} in GitKraken.`);
    }
  }

  async function openInFolder(name: string, label = "folder") {
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(name)}/reveal`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      console.error("reveal repo folder:", e);
      toast.error(`Couldn't open ${name} in ${label}.`);
    }
  }

  async function openUpstart(repo: RepoInfo, debug = false, context?: string) {
    let trimmedContext = context?.trim();
    if (!debug && !repo.hasUpstart && context === undefined) {
      const entered = await prompt({
        title: "Create and run upstart",
        message: "Optional startup context for the agent. Leave blank to continue without it.",
        input: { placeholder: "Context..." },
        confirmLabel: "Run",
      });
      trimmedContext = entered?.trim() ?? "";
    }
    const upstartPath =
      repo.upstartPath?.trim() ||
      `${(process.env.NEXT_PUBLIC_REPO_ROOT ?? "").trim()}/upstarts/${repo.name}/upstart.sh`;
    openTerminal({
      cwd: repo.path,
      label: `${debug ? "Debug upstart" : "Upstart"} · ${repo.name}`,
      command: debug
        ? await agentRepoUpstartDebugCommand(repo.name, upstartPath, trimmedContext)
        : repo.hasUpstart && trimmedContext
          ? await agentRepoUpstartUpdateCommand(repo.name, upstartPath, trimmedContext)
        : repo.hasUpstart
          ? repoUpstartCommand(upstartPath)
          : await agentRepoUpstartCommand(repo.name, upstartPath, trimmedContext),
    });
  }

  async function openDxAudit(repo: RepoInfo) {
    const context = await prompt({
      title: `DX audit · ${repo.name}`,
      message:
        "Optional live question for the audit (e.g. \"should we move to Expo Go?\"). Leave blank for a full sweep.",
      input: { placeholder: "Question/context..." },
      confirmLabel: "Run audit",
    });
    if (context === null) return;
    openTerminal({
      cwd: repo.path,
      label: `DX audit · ${repo.name}`,
      command: await agentRepoDxAuditCommand(repo.name, context.trim() || undefined),
    });
  }

  async function cloneRepo(fullName: string) {
    setCloning(fullName);
    try {
      const res = await fetch("/api/repos/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName }),
      });
      if (!res.ok) throw new Error(await res.text());
      await Promise.all([mutateLocal(), mutateGithub()]);
      toast.success(`Cloned ${fullName}`);
    } catch (e) {
      console.error("clone repo:", e);
      toast.error(`Couldn't clone ${fullName}.`);
    } finally {
      setCloning(null);
    }
  }

  async function removeRepo(name: string) {
    const ok = await confirm({
      title: `Remove local repo "${name}"?`,
      message: "This will delete the local folder only.",
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    setRemoving(name);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await Promise.all([mutateLocal(), mutateGithub()]);
      toast.success(`Removed ${name}`);
    } catch (e) {
      console.error("remove repo:", e);
      toast.error(`Couldn't remove ${name}.`);
    } finally {
      setRemoving(null);
    }
  }

  return {
    opening,
    cloning,
    removing,
    openInCursor,
    openInTerminal,
    openInGitKraken,
    openInFolder,
    openUpstart,
    openDxAudit,
    cloneRepo,
    removeRepo,
    launchClaudeDesktop,
  };
}
