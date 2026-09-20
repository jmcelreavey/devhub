"use client";

import { SkillAgentDialog,type SkillAgentLaunchTarget } from "@/components/tasks/SkillAgentDialog";
import { useLive } from "@/lib/hooks/use-fetch";
import { taskImplementPlanUrl } from "@/lib/tasks/implement-prompt";
import {
buildTaskAgentResumePrompt,
formatAgentActivityTrailForResume,
mapAgentDispatchProviderToUi,
willResumeFollowUpSession,
} from "@/lib/tasks/task-agent-resume";
import type { TaskAgentRunRecord } from "@/lib/tasks/task-agent-runs";
import type { Task } from "@/lib/tasks/types";
import { TASK_AGENT_RUNS_KEY } from "@/lib/tasks/use-task-agent-runs";
import { useMemo,useState } from "react";
import { mutate } from "swr";

type AgentRunDetail = {
  run?: {
    id: string;
    provider: string;
    sessionId: string | null;
    state: string;
  };
  events?: Array<{ type: string; text?: string; ok?: boolean }>;
};

type AgentProvidersResponse = {
  providers?: Array<{ id: string; label: string; supportsResume: boolean }>;
};

export function ResumeTaskDialog({
  open,
  task,
  date,
  onClose,
  latestRun,
  handoff = "",
  cwd,
  repoName,
}: {
  open: boolean;
  task: Task;
  date: string;
  onClose: () => void;
  latestRun: TaskAgentRunRecord | null;
  handoff?: string;
  cwd?: string;
  repoName?: string;
}) {
  const priorRunKey = open && latestRun?.runId
    ? `/api/agent/runs/${encodeURIComponent(latestRun.runId)}?since=0&limit=500`
    : null;
  const { data: priorDetail } = useLive<AgentRunDetail>(priorRunKey, {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });
  const { data: providersData } = useLive<AgentProvidersResponse>(open ? "/api/agent/runs?limit=1" : null, {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });

  const initialProvider = useMemo((): SkillAgentLaunchTarget => {
    const fromSidecar = mapAgentDispatchProviderToUi(latestRun?.provider);
    if (fromSidecar !== "default") return fromSidecar as SkillAgentLaunchTarget;
    return mapAgentDispatchProviderToUi(priorDetail?.run?.provider) as SkillAgentLaunchTarget;
  }, [latestRun?.provider, priorDetail?.run?.provider]);

  // Remount SkillAgentDialog when the dialog opens / prior CLI changes so the
  // picker state matches initialProvider without a syncing effect.
  const [pickedProvider, setPickedProvider] = useState<{
    forInitial: SkillAgentLaunchTarget;
    value: SkillAgentLaunchTarget;
  } | null>(null);
  const effectiveProvider =
    pickedProvider && pickedProvider.forInitial === initialProvider
      ? pickedProvider.value
      : initialProvider;

  const priorDispatchProvider = priorDetail?.run?.provider ?? latestRun?.provider;
  const priorSessionId = priorDetail?.run?.sessionId ?? latestRun?.sessionId ?? null;
  const priorProvider = providersData?.providers?.find((p) => p.id === priorDispatchProvider);
  const priorSupportsResume = priorProvider?.supportsResume ?? false;

  const attention = latestRun?.attention;
  const followUp = willResumeFollowUpSession({
    priorDispatchProvider,
    selectedUiProvider: effectiveProvider,
    priorSessionId,
    priorSupportsResume,
  });

  const activityTrail = formatAgentActivityTrailForResume(priorDetail?.events ?? []);

  const promptInput = () => ({
    origin: typeof window === "undefined" ? "" : window.location.origin,
    taskId: task.id,
    date,
    handoff,
    priorRunId: latestRun?.runId,
    cwd,
    repoName,
    jiraKey: task.jiraKey,
    activityTrail: activityTrail || undefined,
    ...(attention ? { attention: { ...attention, prUrl: latestRun?.prUrl } } : {}),
  });

  // Sent back for this finding — the watcher stays quiet until it changes.
  const markAttentionHandled = () => {
    if (!attention || !latestRun) return;
    void fetch("/api/tasks/agent-runs/attention", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, runId: latestRun.runId }),
    }).finally(() => void mutate(TASK_AGENT_RUNS_KEY));
  };

  return (
    <SkillAgentDialog
      key={open ? `resume-${latestRun?.runId ?? "none"}-${initialProvider}` : "resume-closed"}
      open={open}
      onClose={onClose}
      title={attention ? "Fix PR with agent" : "Resume with agent"}
      description={
        attention
          ? `${attention.summary}. The agent gets this plus the handoff and fixes it on the same branch.`
          : "Choose the CLI. Keep the same provider as the prior run when you want to continue its session."
      }
      onLaunched={markAttentionHandled}
      initialProvider={initialProvider}
      onProviderChange={(value) => setPickedProvider({ forInitial: initialProvider, value })}
      getPrompt={() => buildTaskAgentResumePrompt(promptInput())}
      cwd={cwd}
      repoName={repoName}
      summary={`${attention ? "Fix PR for" : "Resume"} ${task.text}`}
      reason={`Resume DevHub task ${task.id}`}
      taskId={task.id}
      taskDate={date}
      parentRunId={latestRun?.runId}
      resumeSessionId={followUp ? priorSessionId ?? undefined : undefined}
      launchButtonLabel={attention ? "Send agent back" : "Resume agent"}
      banner={
        latestRun ? (
          <ResumeModeBanner
            followUp={followUp}
            priorLabel={priorProvider?.label ?? priorDispatchProvider}
            priorSessionId={priorSessionId}
            priorSupportsResume={priorSupportsResume}
            hasHandoff={Boolean(handoff.trim())}
          />
        ) : null
      }
      resolveCwd={
        cwd
          ? undefined
          : async () => {
              const planResponse = await fetch(taskImplementPlanUrl(promptInput()), { cache: "no-store" });
              const plan = (await planResponse.json().catch(() => ({}))) as {
                error?: string;
                repoPath?: string | null;
              };
              if (!planResponse.ok) throw new Error(plan.error || "Couldn't load the task plan");
              return plan.repoPath ?? undefined;
            }
      }
    />
  );
}

function ResumeModeBanner({
  followUp,
  priorLabel,
  priorSessionId,
  priorSupportsResume,
  hasHandoff,
}: {
  followUp: boolean;
  priorLabel: string | undefined;
  priorSessionId: string | null | undefined;
  priorSupportsResume: boolean;
  hasHandoff: boolean;
}) {
  const cli = priorLabel ?? "the previous CLI";
  let detail: string;
  if (followUp) detail = `Picks up your last ${cli} session where it left off.`;
  else if (priorSessionId && !priorSupportsResume) detail = `${cli} can't reopen past sessions, so this starts fresh.`;
  else if (priorSessionId) detail = `Starts fresh. Choose ${cli} to continue the last session instead.`;
  else detail = "Starts a fresh session.";

  return (
    <p className="mb-4 rounded-lg border border-border-muted bg-bg-elevated px-3 py-2 text-xs text-text-muted">
      <span className="font-medium text-text">{followUp ? "Continue session" : "New session"}</span> — {detail}{" "}
      {hasHandoff
        ? "The agent gets the saved handoff notes."
        : "No handoff notes yet, so the agent checks the repo and branch first."}
    </p>
  );
}
