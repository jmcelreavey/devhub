"use client";

import { useConfirm,useDecision,usePrompt } from "@/components/shell/ConfirmDialog";
import { launchAgentJob } from "@/lib/agent-job";
import { useToast } from "@/lib/hooks/use-toast";
import {
agentRepoDxAuditPrompt,
openTerminal,
repoUpstartCommand
} from "@/lib/terminal-launch";
import { useRef,useState } from "react";
import { UPSTART_WORKTREE_INSTRUCTIONS } from "@/lib/repos/upstart-command";
import { workspaceOption, type WorktreeInfo } from "@/lib/repos/worktree-info";
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
  const [upstarting, setUpstarting] = useState<string | null>(null);
  const upstartBusy = useRef(false);
  const toast = useToast();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const decide = useDecision();

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

  async function openUpstart(repo: RepoInfo, debug = false, context?: string, taskId?: string) {
    if (upstartBusy.current) return;
    upstartBusy.current = true;
    setUpstarting(repo.name);
    try {
      // Discover on every launch: another agent may have added or removed a checkout.
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      const isCurrentCheckout = (path: string) => path.replace(/\/+$/, "") === repo.path.replace(/\/+$/, "");
      let worktrees: WorktreeInfo[];
      let preferredPath: string | null = null;
      try {
        const response = await fetch(`/api/repos/${encodeURIComponent(repo.name)}/worktrees${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ""}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not load workspaces. Try again.");
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || !("worktrees" in payload) ||
          !Array.isArray(payload.worktrees) || !payload.worktrees.every((tree: unknown) =>
            tree !== null && typeof tree === "object" &&
            "path" in tree && typeof tree.path === "string" && tree.path.startsWith("/") &&
            "branch" in tree && (tree.branch === null || typeof tree.branch === "string") &&
            "prunable" in tree && typeof tree.prunable === "boolean")) {
          throw new Error("Invalid workspace list. Refresh the repository and try again.");
        }
        preferredPath = "preferredPath" in payload && typeof payload.preferredPath === "string" ? payload.preferredPath : null;
        worktrees = (payload.worktrees as WorktreeInfo[])
          .filter((tree) => !tree.prunable)
          .sort((a, b) =>
            Number(isCurrentCheckout(b.path)) - Number(isCurrentCheckout(a.path)) ||
            Number(Boolean(b.branch)) - Number(Boolean(a.branch)) ||
            (a.branch ?? "").localeCompare(b.branch ?? "") ||
            a.path.localeCompare(b.path),
          );
      } finally {
        window.clearTimeout(timeout);
      }
      if (worktrees.length === 0) throw new Error("No available workspace. Refresh the repository and try again.");

      if (preferredPath && !worktrees.some((tree) => tree.path === preferredPath)) {
        throw new Error("This task’s checkout is no longer available. Open Worktrees to review it; no other branch was started.");
      }
      const selectedPath = preferredPath || (!taskId && worktrees.length === 1 ? worktrees[0].path : await decide({
        title: `Upstart · ${repo.name}`,
        message: taskId ? "No checkout is linked to this task yet. Choose the work you want to start." : "Choose the work you want to start. Branches and linked notes are shown below each title.",
        options: worktrees.map((tree) => workspaceOption(tree, repo.path)),
      }));
      if (selectedPath === null) return;
      const workspace = worktrees.find((tree) => tree.path === selectedPath);
      if (!workspace) throw new Error("That workspace is no longer available. Try again.");

      let trimmedContext = context?.trim();
      if (!debug && !repo.hasUpstart && context === undefined) {
        const entered = await prompt({
          title: "Create and run upstart",
          message: "Optional startup context for the agent. Leave blank to continue without it.",
          input: { placeholder: "Context..." },
          confirmLabel: "Run",
        });
        if (entered === null) return;
        trimmedContext = entered.trim();
      }
      const upstartPath =
        repo.upstartPath?.trim() ||
        `${(process.env.NEXT_PUBLIC_REPO_ROOT ?? "").trim()}/upstarts/${repo.name}/upstart.sh`;
      const label = `${debug ? "Debug upstart" : "Upstart"} · ${repo.name} · ${workspace.branch || "Detached HEAD"}`;
      // The script remains canonical; only its working directory follows the selection.
      if (!debug && repo.hasUpstart && !trimmedContext) {
        openTerminal({
          cwd: workspace.path,
          label,
          kind: "upstart",
          repoName: repo.name,
          command: repoUpstartCommand(upstartPath, workspace.path),
        });
        return;
      }
      await launchAgentJob({
        title: label,
        kind: "upstart",
        cwd: workspace.path,
        repoName: repo.name,
        promptText: `Use devhub-repo-upstart. ${debug ? "Debug" : repo.hasUpstart ? "Update" : "Create"} ${upstartPath} for ${repo.name} in the DevHub private store. Work in the selected workspace: ${workspace.path}. ${UPSTART_WORKTREE_INSTRUCTIONS} Keep one-command startup, use nvm use when .nvmrc exists and refresh dependencies. Do not run the resulting script; it requires the existing DevHub review before execution. Context: ${trimmedContext || "none"}`,
        mode: debug ? "interactive" : "oneshot",
        forceTerminal: true,
        reason: label,
        alreadyConfirmed: true,
      });
    } catch (error) {
      toast.error(error !== null && typeof error === "object" && "name" in error && error.name === "AbortError"
        ? "Loading workspaces timed out. Try Upstart again."
        : error instanceof Error ? error.message : "Could not start Upstart. Try again.");
    } finally {
      upstartBusy.current = false;
      setUpstarting(null);
    }
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
    upstarting,
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
