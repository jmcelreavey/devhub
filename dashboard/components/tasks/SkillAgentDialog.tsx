"use client";

import { AgentLaunchForm } from "@/components/agents/AgentLaunchSheet";
import { TASK_AGENT_RUNS_KEY } from "@/lib/tasks/use-task-agent-runs";
import { useEffect,useRef,useState,type ReactNode } from "react";
import { mutate } from "swr";

export type SkillAgentLaunchTarget = string;
export type AgentStage = "plan" | "implement" | "create-pr";

interface Props {
  open: boolean; onClose: () => void; title: string; description: string;
  getPrompt: () => string; cwd?: string; repoName?: string; summary: string; reason: string;
  resolveCwd?: () => Promise<string | undefined>; taskId?: string; taskDate?: string;
  banner?: ReactNode; launchDisabled?: boolean; launchDisabledReason?: string;
  initialProvider?: SkillAgentLaunchTarget; onProviderChange?: (provider: SkillAgentLaunchTarget) => void;
  launchButtonLabel?: string; resumeSessionId?: string; parentRunId?: string;
  stage?: AgentStage; onLaunched?: () => void;
  kind?: "agent" | "review"; worktree?: boolean;
  cancelLabel?: string; promptDisclosureLabel?: string;
  requireExplicitDismissal?: boolean;
  allowAuto?: boolean;
  autoByDefault?: boolean;
}

/** Reuse the same handoff sheet while keeping the task's readiness checks. */
export function SkillAgentDialog(props: Props) {
  return props.open ? <TaskLaunch {...props} /> : null;
}

function TaskLaunch(props: Props) {
  const [requestId] = useState(() => crypto.randomUUID());
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const close = () => { active.current = false; props.onClose(); };
  return <AgentLaunchForm
    intent={{
      requestId, title: props.title, runTitle: props.summary, prompt: props.getPrompt(), cwd: props.cwd, repoName: props.repoName,
      provider: props.initialProvider === "default" ? undefined : props.initialProvider,
      taskId: props.taskId, taskDate: props.taskDate,
      kind: props.kind,
      stage: props.parentRunId ? "resume" : props.stage ?? (props.kind ? undefined : "implement"),
      parentRunId: props.parentRunId, resumeSessionId: props.resumeSessionId,
      worktree: props.worktree ?? (!props.parentRunId && props.stage !== "plan"),
    }}
    current={() => active.current}
    close={close}
    description={props.description}
    cancelLabel={props.cancelLabel}
    launchButtonLabel={props.launchButtonLabel}
    promptDisclosureLabel={props.promptDisclosureLabel}
    requireExplicitDismissal={props.requireExplicitDismissal}
    allowAuto={props.allowAuto}
    autoByDefault={props.autoByDefault}
    // New plan, implement and PR runs for a task take a model tier; a follow-up keeps its session's agent.
    tierStep={props.taskId && !props.parentRunId && !props.kind ? (props.stage === "plan" ? "plan" : props.stage === "create-pr" ? "draft-pr" : "implement") : undefined}
    showWorktreeOption={props.kind !== "agent"}
    banner={props.banner}
    disabled={props.launchDisabled}
    disabledReason={props.launchDisabledReason}
    resolveCwd={props.resolveCwd}
    onProviderChange={props.onProviderChange}
    onStarted={() => { void mutate(TASK_AGENT_RUNS_KEY); props.onLaunched?.(); }}
  />;
}
