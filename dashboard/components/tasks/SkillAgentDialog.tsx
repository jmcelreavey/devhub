"use client";

import { AgentLaunchForm } from "@/components/agents/AgentLaunchSheet";
import { checkImplementGuardrails } from "@/lib/tasks/implement-guardrails";
import { TASK_AGENT_RUNS_KEY } from "@/lib/tasks/use-task-agent-runs";
import { useEffect,useRef,useState,type ReactNode } from "react";
import { mutate } from "swr";

export type SkillAgentLaunchTarget = string;
export type AgentStage = "plan" | "implement";

interface Props {
  open: boolean; onClose: () => void; title: string; description: string;
  getPrompt: () => string; cwd?: string; repoName?: string; summary: string; reason: string;
  resolveCwd?: () => Promise<string | undefined>; taskId?: string; taskDate?: string;
  banner?: ReactNode; launchDisabled?: boolean; launchDisabledReason?: string;
  initialProvider?: SkillAgentLaunchTarget; onProviderChange?: (provider: SkillAgentLaunchTarget) => void;
  launchButtonLabel?: string; resumeSessionId?: string; parentRunId?: string;
  stage?: AgentStage; onLaunched?: () => void;
}

/** Reuse the same handoff sheet while keeping the task's readiness checks. */
export function SkillAgentDialog(props: Props) {
  return props.open ? <TaskLaunch {...props} /> : null;
}

function TaskLaunch(props: Props) {
  const [requestId] = useState(() => crypto.randomUUID());
  const active = useRef(true);
  useEffect(() => () => { active.current = false; }, []);
  const close = () => { active.current = false; props.onClose(); };
  return <AgentLaunchForm
    intent={{
      requestId, title: props.title, prompt: props.getPrompt(), cwd: props.cwd, repoName: props.repoName,
      provider: props.initialProvider === "default" ? undefined : props.initialProvider,
      taskId: props.taskId, taskDate: props.taskDate, stage: props.parentRunId ? "resume" : props.stage ?? "implement",
      parentRunId: props.parentRunId, resumeSessionId: props.resumeSessionId,
      worktree: !props.parentRunId && props.stage !== "plan",
    }}
    current={() => active.current}
    close={close}
    banner={props.banner}
    disabled={props.launchDisabled}
    disabledReason={props.launchDisabledReason}
    resolveCwd={props.resolveCwd}
    onProviderChange={props.onProviderChange}
    beforeStart={async () => {
      const guard = await checkImplementGuardrails();
      if (guard.blocked) throw new Error(guard.reason || "Too many agent runs are active.");
    }}
    onStarted={() => { void mutate(TASK_AGENT_RUNS_KEY); props.onLaunched?.(); }}
  />;
}
