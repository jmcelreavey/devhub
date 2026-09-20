"use client";

import { SkillAgentDialog } from "@/components/tasks/SkillAgentDialog";
import { buildTaskPlanPrompt,taskImplementPlanUrl } from "@/lib/tasks/implement-prompt";
import type { Task } from "@/lib/tasks/types";

/**
 * Draft → plan. The agent investigates and writes Plan / Acceptance / Open
 * questions into the task note, then marks the task ready only when nothing is
 * left to ask. Not linked to the task's runs: Resume/Continue stays about the
 * implementation, not the planning session.
 */
export function PlanTaskDialog({
  open,
  task,
  date,
  onClose,
  cwd,
  repoName,
  onLaunched,
}: {
  open: boolean;
  task: Task;
  date: string;
  onClose: () => void;
  cwd?: string;
  repoName?: string;
  onLaunched?: () => void;
}) {
  const promptInput = () => ({
    origin: typeof window === "undefined" ? "" : window.location.origin,
    taskId: task.id,
    date,
    cwd,
    repoName: repoName ?? task.links?.find((link) => link.kind === "repo")?.id,
    jiraKey: task.jiraKey,
  });

  return (
    <SkillAgentDialog
      open={open}
      onClose={onClose}
      stage="plan"
      taskId={task.id}
      taskDate={date}
      title="Write plan with agent"
      description="A planning pass: the agent investigates and writes the plan into the task note. It doesn't change code. Pick a model that's good at reasoning."
      launchButtonLabel="Start planning"
      getPrompt={() => buildTaskPlanPrompt(promptInput())}
      cwd={cwd}
      repoName={promptInput().repoName}
      summary={`Plan ${task.text}`}
      reason={`Write the plan for DevHub task ${task.id}`}
      onLaunched={onLaunched}
      resolveCwd={
        cwd
          ? undefined
          : async () => {
              const res = await fetch(taskImplementPlanUrl(promptInput()), { cache: "no-store" });
              const plan = (await res.json().catch(() => ({}))) as { repoPath?: string | null };
              return plan.repoPath ?? undefined;
            }
      }
    />
  );
}
