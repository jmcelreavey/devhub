"use client";

import { useState } from "react";
import { Bot, Copy, Loader2, Play } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import type { Task } from "@/lib/tasks/types";
import {
  buildTaskImplementPrompt,
  taskImplementPlanUrl,
  type TaskImplementPromptInput,
} from "@/lib/tasks/implement-prompt";
import {
  taskImplementationCommand,
  type TaskImplementationProvider,
} from "@/lib/terminal-launch";
import { proposeTerminalRun } from "@/lib/terminal-inject";
import { useToast } from "@/lib/hooks/use-toast";
import { useLaunchChamberDesktop } from "@/lib/launch/chamber";
import { checkImplementGuardrails } from "@/lib/tasks/implement-guardrails";
import { copyTextToClipboard } from "@/lib/clipboard";

type ImplementationTarget = TaskImplementationProvider | "openchamber";

const PROVIDERS: Array<{
  id: ImplementationTarget;
  label: string;
  description: string;
}> = [
  { id: "default", label: "Default", description: "Use your configured agent CLI" },
  { id: "opencode", label: "OpenCode", description: "OpenCode terminal agent" },
  { id: "claude", label: "Claude", description: "Claude Code CLI" },
  { id: "cursor", label: "Cursor", description: "Cursor agent CLI" },
  { id: "chatgpt", label: "ChatGPT", description: "ChatGPT / Codex CLI" },
  { id: "openchamber", label: "OpenChamber", description: "Copy prompt and open the desktop app" },
];

export function ImplementTaskDialog({
  open,
  task,
  date,
  onClose,
}: {
  open: boolean;
  task: Task;
  date: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const launchChamber = useLaunchChamberDesktop();
  const [provider, setProvider] = useState<ImplementationTarget>("default");
  const [model, setModel] = useState("");
  const [launching, setLaunching] = useState(false);
  const repoLinks = task.links?.filter((link) => link.kind === "repo") ?? [];
  const repoName = repoLinks.length === 1 ? repoLinks[0]?.id : undefined;

  const promptInput = (): TaskImplementPromptInput => ({
      origin: window.location.origin,
      taskId: task.id,
      date,
      repoName,
    });
  const buildPrompt = () => buildTaskImplementPrompt(promptInput());

  const copyPrompt = async () => {
    try {
      await copyTextToClipboard(buildPrompt());
      toast.success("Implementation prompt copied");
    } catch {
      toast.error("Couldn't copy the implementation prompt");
    }
  };

  const launch = async () => {
    if (launching) return;
    setLaunching(true);
    try {
      const guard = await checkImplementGuardrails();
      if (guard.blocked) {
        toast.error(guard.reason ?? "Too many agent runs queued.");
        return;
      }
      if (provider === "openchamber") {
        await copyTextToClipboard(buildPrompt());
        await launchChamber();
        toast.success("Implementation prompt copied for OpenChamber");
        onClose();
        return;
      }
      const agent = await taskImplementationCommand(provider, buildPrompt(), model);
      const planResponse = await fetch(taskImplementPlanUrl(promptInput()), { cache: "no-store" });
      const plan = (await planResponse.json().catch(() => ({}))) as { error?: string; repoPath?: string | null };
      if (!planResponse.ok) throw new Error(plan.error || "Couldn't load the task implementation plan");
      proposeTerminalRun({
        command: agent.command,
        label: `Implement task - ${agent.label}`,
        summary: `Implement ${task.text}`,
        providerLabel: agent.label,
        kind: "agent",
        cwd: plan.repoPath ?? undefined,
        repoName,
        preferAgentTab: true,
        forceNewTab: true,
        reason: `Implement DevHub task ${task.id}`,
        source: "ui",
        mode: "interactive",
        skipConfirm: true,
      });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't launch the agent");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Implement with agent"
      description="Choose the CLI for this task. Leave model blank to use that CLI's default."
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => void copyPrompt()}>
            <Copy size={13} aria-hidden /> Copy prompt
          </button>
          <button type="button" className="btn btn-primary" disabled={launching} onClick={() => void launch()}>
            {launching ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Play size={13} aria-hidden />}
            Launch agent
          </button>
        </div>
      }
    >
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-xs font-medium text-text-muted">Agent</legend>
        {PROVIDERS.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2"
            style={{
              border: `1px solid ${provider === option.id ? "var(--accent)" : "var(--border-muted)"}`,
              background: provider === option.id ? "var(--bg-hover)" : "transparent",
            }}
          >
            <input
              type="radio"
              name="task-agent-provider"
              value={option.id}
              checked={provider === option.id}
              onChange={() => setProvider(option.id)}
            />
            <Bot size={14} className="shrink-0 text-text-muted" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-text">{option.label}</span>
              <span className="block text-xs text-text-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="mt-4 block text-xs font-medium text-text-muted">
        Model override
        <input
          className="input mt-1 w-full"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="Default model"
          autoComplete="off"
          disabled={provider === "openchamber"}
        />
      </label>
    </ModalShell>
  );
}
