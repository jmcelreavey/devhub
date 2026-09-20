"use client";

import { useConfirm,usePrompt } from "@/components/shell/ConfirmDialog";
import { launchAgentJob } from "@/lib/agent-job";
import { useToast } from "@/lib/hooks/use-toast";
import {
agentRepoDxAuditPrompt,
openTerminal,
repoUpstartCommand
} from "@/lib/terminal-launch";
import { useState } from "react";
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
  const prompt = usePrompt();
  const confirm = useConfirm();

  async function openInCursor(name: string) {
    setOpening(name);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(name)}/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      console.error("open in cursor:", e);
      toast.error(`Couldn't open ${name} in Cursor.`);
    } finally {
      setOpening(null);
    }
  }

  function openInTerminal(repo: { name: string; path: string }) {
    // Always a fresh tab: reusing the repo's existing tab reads as "the click
    // did nothing" when the dock is already open on that tab.
    openTerminal({
      cwd: repo.path,
      label: repo.name,
      kind: "shell",
      repoName: repo.name,
    });
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
    const label = `${debug ? "Debug upstart" : "Upstart"} · ${repo.name}`;
    // Approved script run stays a plain shell inject — no agent handoff.
    if (!debug && repo.hasUpstart && !trimmedContext) {
      openTerminal({
        cwd: repo.path,
        label,
        kind: "upstart",
        repoName: repo.name,
        command: repoUpstartCommand(upstartPath, repo.path),
      });
      return;
    }
    await launchAgentJob({
      title: label,
      kind: "upstart",
      cwd: repo.path,
      repoName: repo.name,
      promptText: `Use devhub-repo-upstart. ${debug ? "Debug" : repo.hasUpstart ? "Update" : "Create"} ${upstartPath} for ${repo.name} in the DevHub private store. Keep one-command startup, use nvm use when .nvmrc exists and refresh dependencies. Do not run the resulting script; it requires the existing DevHub review before execution. Context: ${trimmedContext || "none"}`,
      // Upstart generation is interactive-ish / must land in a PTY near the script.
      mode: debug ? "interactive" : "oneshot",
      forceTerminal: true,
      reason: label,
      alreadyConfirmed: true,
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
    const audit = agentRepoDxAuditPrompt(repo.name, context.trim() || undefined);
    await launchAgentJob({
      title: `DX audit · ${repo.name}`,
      kind: "review",
      cwd: repo.path,
      repoName: repo.name,
      notePath: audit.notePath,
      promptText: audit.prompt,
      mode: "oneshot",
      reason: `DX audit ${repo.name}`,
      alreadyConfirmed: true,
    });

  }

  async function cloneFromUrl() {
    const url = await prompt({
      title: "Clone from URL",
      message: "Clones into the repos scan folder. HTTPS, SSH, or a local path.",
      input: { placeholder: "git@github.com:org/repo.git" },
      confirmLabel: "Clone",
    });
    if (!url?.trim()) return;
    const name = await prompt({
      title: "Folder name",
      message: "Optional. Leave blank to use the repo name from the URL.",
      input: { placeholder: "my-repo" },
      confirmLabel: "Clone",
    });
    if (name === null) return;
    const trimmedUrl = url.trim();
    setCloning(trimmedUrl);
    try {
      const res = await fetch("/api/repos/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmedUrl,
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await mutateLocal();
      toast.success("Cloned into the scan folder");
    } catch (e) {
      console.error("clone from url:", e);
      toast.error("Couldn't clone that URL.");
    } finally {
      setCloning(null);
    }
  }

  async function initRepo() {
    const name = await prompt({
      title: "New repository",
      message: "Creates an empty git repo in the scan folder.",
      input: { placeholder: "my-project" },
      confirmLabel: "Create",
    });
    if (!name?.trim()) return;
    setCloning(name.trim());
    try {
      const res = await fetch("/api/repos/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      await mutateLocal();
      toast.success(`Created ${name.trim()}`);
    } catch (e) {
      console.error("init repo:", e);
      toast.error(`Couldn't create ${name.trim()}.`);
    } finally {
      setCloning(null);
    }
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
    cloneFromUrl,
    initRepo,
    removeRepo,
  };
}
