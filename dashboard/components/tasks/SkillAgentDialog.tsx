"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { Bot, Copy, Loader2, Play } from "lucide-react";
import { ModalShell } from "@/components/shell/ModalShell";
import {
  resolveTaskImplementationProvider,
  taskImplementationCommand,
  type TaskImplementationProvider,
} from "@/lib/terminal-launch";
import { proposeTerminalRun } from "@/lib/terminal-inject";
import { useToast } from "@/lib/hooks/use-toast";
import { useLaunchChamberDesktop } from "@/lib/launch/chamber";
import { checkImplementGuardrails } from "@/lib/tasks/implement-guardrails";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  agentActivityHrefForRun,
  mapUiProviderToAgentDispatch,
  newInteractiveTaskAgentRunId,
} from "@/lib/tasks/task-agent-resume";
import { TASK_AGENT_RUNS_KEY } from "@/lib/tasks/use-task-agent-runs";

export type SkillAgentLaunchTarget = TaskImplementationProvider | "openchamber";

const PROVIDERS: Array<{
  id: SkillAgentLaunchTarget;
  label: string;
  description: string;
}> = [
  { id: "default", label: "Default", description: "Use your configured agent CLI" },
  { id: "opencode", label: "OpenCode", description: "OpenCode terminal agent" },
  { id: "claude", label: "Claude", description: "Claude Code CLI" },
  { id: "cursor", label: "Cursor", description: "Cursor agent CLI" },
  { id: "chatgpt", label: "ChatGPT", description: "ChatGPT / Codex CLI" },
  { id: "antigravity", label: "Antigravity", description: "Antigravity CLI (agy)" },
  { id: "openchamber", label: "OpenChamber", description: "Copy prompt and open the desktop app" },
];

interface InteractiveRegistration {
  runId: string;
  /** Shell fragments that report the tab's start and the CLI's exit. */
  wrap: { before: string; after: string };
}

/** Agent Activity + optional task link for an interactive CLI session. */
async function registerInteractiveAgentRun(opts: {
  taskId?: string;
  provider: string;
  sessionId?: string;
  prompt: string;
  cwd: string;
  title: string;
  model?: string;
}): Promise<InteractiveRegistration> {
  const res = await fetch("/api/agent/runs/interactive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: newInteractiveTaskAgentRunId(),
      provider: mapUiProviderToAgentDispatch(opts.provider) ?? opts.provider,
      prompt: opts.prompt,
      cwd: opts.cwd,
      title: opts.title.slice(0, 80),
      model: opts.model,
      sessionId: opts.sessionId,
      taskId: opts.taskId,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    run?: { id: string };
    wrap?: InteractiveRegistration["wrap"];
    error?: string;
  };
  if (!res.ok || !body.run?.id || !body.wrap) {
    throw new Error(body.error || `Couldn't register interactive run (HTTP ${res.status})`);
  }
  return { runId: body.run.id, wrap: body.wrap };
}

/**
 * Planning wants a reasoning model, implementation a fast coder: remember the
 * last model per stage and CLI so each dialog opens with the right one.
 */
export type AgentStage = "plan" | "implement";

function modelKey(stage: AgentStage, provider: string): string {
  return `devhub.agentModel.${stage}.${provider}`;
}

function readStageModel(stage: AgentStage, provider: string): string {
  try {
    return window.localStorage.getItem(modelKey(stage, provider)) ?? "";
  } catch {
    return "";
  }
}

function saveStageModel(stage: AgentStage, provider: string, model: string): void {
  try {
    if (model) window.localStorage.setItem(modelKey(stage, provider), model);
    else window.localStorage.removeItem(modelKey(stage, provider));
  } catch {
    // Private windows can refuse storage; the override still applies to this launch.
  }
}

function appendInteractiveActivityHint(prompt: string, runId: string): string {
  const block = [
    "",
    "## DevHub Agent Activity (required)",
    `Your Agent Activity run id is \`${runId}\`.`,
    "Agent Activity is the audit trail for this session. Call MCP `agent_interactive_note` with that runId at EVERY milestone below — do not batch them into one note at the end:",
    '1. Check-in — before any code: goal, assumptions, questions (or "no questions").',
    "2. After I answer (or you proceed) — what we decided.",
    "3. When you finish a review note, open Cursor/another tool, start/stop a verify (tests/CI), or change plan.",
    "4. When I ask you to commit, push, open a PR, pause, or stop — note that instruction before you act.",
    "5. After commit/push/PR — branch, SHA or PR URL, verify status.",
    "When the implement goal is done (or I tell you to stop), call MCP `agent_interactive_finish` with runId, `ok`, your CLI `sessionId`, and a short `resultText` — even if the terminal stays open. Closing the tab is only a backup.",
    "",
  ].join("\n");
  return `${prompt.trimEnd()}\n${block}`;
}

/**
 * Pick a CLI and open it interactively in the terminal dock. Every launch is
 * tracked in Agent Activity (and linked to `taskId` when given) when a repo
 * path is known.
 */
export function SkillAgentDialog({
  open,
  onClose,
  title,
  description,
  getPrompt,
  cwd,
  repoName,
  summary,
  reason,
  resolveCwd,
  taskId,
  banner,
  launchDisabled,
  launchDisabledReason,
  initialProvider = "default",
  onProviderChange,
  launchButtonLabel = "Launch agent",
  resumeSessionId,
  stage = "implement",
  onLaunched,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  getPrompt: () => string;
  cwd?: string;
  repoName?: string;
  summary: string;
  reason: string;
  resolveCwd?: () => Promise<string | undefined>;
  /** Links the launched run to this DevHub task. */
  taskId?: string;
  /** Optional panel above the agent picker (e.g. implement-ready checklist). */
  banner?: ReactNode;
  launchDisabled?: boolean;
  launchDisabledReason?: string;
  initialProvider?: SkillAgentLaunchTarget;
  onProviderChange?: (provider: SkillAgentLaunchTarget) => void;
  launchButtonLabel?: string;
  /** Continue a prior CLI session when the selected provider supports it. */
  resumeSessionId?: string;
  /** Which remembered model to prefill. */
  stage?: AgentStage;
  /** After the CLI was handed to the terminal dock. */
  onLaunched?: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const launchChamber = useLaunchChamberDesktop();
  const [provider, setProvider] = useState<SkillAgentLaunchTarget>(initialProvider);
  const [extraContext, setExtraContext] = useState("");
  // null = not edited: show the model remembered for this stage + CLI.
  const [editedModel, setModel] = useState<string | null>(null);
  const model = editedModel ?? (open && typeof window !== "undefined" ? readStageModel(stage, provider) : "");
  const [launching, setLaunching] = useState(false);

  const selectProvider = (next: SkillAgentLaunchTarget) => {
    setProvider(next);
    setModel(null);
    onProviderChange?.(next);
  };

  /** What the user types here reaches the agent verbatim, under its own heading. */
  const promptWithContext = () => {
    const extra = extraContext.trim();
    return extra ? `${getPrompt().trimEnd()}\n\n## Extra context from me\n${extra}` : getPrompt();
  };

  const copyPrompt = async () => {
    try {
      await copyTextToClipboard(promptWithContext());
      toast.success("Prompt copied");
    } catch {
      toast.error("Couldn't copy the prompt");
    }
  };

  const launchInteractive = async (target: TaskImplementationProvider) => {
    const repoPath = (cwd ?? (await resolveCwd?.()))?.trim() || undefined;
    const cli = await resolveTaskImplementationProvider(target);
    const sessionId = resumeSessionId?.trim() || undefined;
    const modelOverride = model.trim() || undefined;
    saveStageModel(stage, target, modelOverride ?? "");
    const basePrompt = promptWithContext();

    let registration: InteractiveRegistration | null = null;
    if (repoPath) {
      try {
        registration = await registerInteractiveAgentRun({
          taskId,
          provider: cli,
          sessionId,
          prompt: basePrompt,
          cwd: repoPath,
          title,
          model: modelOverride,
        });
      } catch (err) {
        toast.error(`${err instanceof Error ? err.message : "Couldn't register the run"} — Agent Activity won't track it.`);
      }
    }

    const prompt = registration ? appendInteractiveActivityHint(basePrompt, registration.runId) : basePrompt;
    const agent = await taskImplementationCommand(cli, prompt, { model: modelOverride, resumeSessionId: sessionId });
    proposeTerminalRun({
      command: registration
        ? `${registration.wrap.before}; ${agent.command}; ${registration.wrap.after}`
        : agent.command,
      label: `${title} - ${agent.label}`,
      summary,
      providerLabel: agent.label,
      kind: "agent",
      cwd: repoPath,
      repoName,
      reason,
      source: "ui",
      mode: "interactive",
      skipConfirm: true,
    });

    if (registration) {
      const runId = registration.runId;
      void mutate(TASK_AGENT_RUNS_KEY);
      toast.success(`${agent.label} opened in the terminal dock`, {
        action: { label: "View activity", onClick: () => router.push(agentActivityHrefForRun(runId)) },
      });
    } else {
      toast.success(
        repoPath
          ? `${agent.label} opened in the terminal dock`
          : `${agent.label} opened — no repo path, so Agent Activity won't track it`,
      );
    }
  };

  const launch = async () => {
    if (launching) return;
    if (launchDisabled) {
      toast.error(launchDisabledReason ?? "Implement readiness checks failed.");
      return;
    }
    setLaunching(true);
    try {
      const guard = await checkImplementGuardrails();
      if (guard.blocked) {
        toast.error(guard.reason ?? "Too many agent runs queued.");
        return;
      }
      if (provider === "openchamber") {
        await copyTextToClipboard(promptWithContext());
        await launchChamber();
        toast.success("Prompt copied for OpenChamber");
      } else {
        await launchInteractive(provider);
      }
      onLaunched?.();
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
      title={title}
      description={description}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => void copyPrompt()}>
            <Copy size={13} aria-hidden /> Copy prompt
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={launching || launchDisabled}
            title={launchDisabled ? launchDisabledReason : undefined}
            onClick={() => void launch()}
          >
            {launching ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Play size={13} aria-hidden />}
            {launchButtonLabel}
          </button>
        </div>
      }
    >
      {banner}

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-xs font-medium text-text-muted">Agent</legend>
        {PROVIDERS.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2"
            style={{
              border: `1px solid ${provider === option.id ? "var(--accent)" : "var(--border-muted)"}`,
              background: provider === option.id ? "var(--accent-dim)" : "transparent",
            }}
          >
            <input
              type="radio"
              name="skill-agent-provider"
              value={option.id}
              checked={provider === option.id}
              onChange={() => selectProvider(option.id)}
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
        Anything else the agent should know?
        <textarea
          className="input mt-1 w-full"
          rows={2}
          value={extraContext}
          onChange={(event) => setExtraContext(event.target.value)}
          placeholder="Optional — constraints, a link, where to start. It asks before coding either way."
        />
      </label>

      <label className="mt-4 block text-xs font-medium text-text-muted">
        {stage === "plan" ? "Planning model" : "Model override"}
        <input
          className="input mt-1 w-full"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={stage === "plan" ? "A strong reasoning model (remembered)" : "Default model (remembered)"}
          autoComplete="off"
          disabled={provider === "openchamber"}
        />
      </label>
    </ModalShell>
  );
}
