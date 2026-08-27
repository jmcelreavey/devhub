"use client";

import type { Task } from "@/lib/tasks/types";
import {
  buildTaskImplementPrompt,
  taskImplementPlanUrl,
  type TaskImplementPromptInput,
} from "@/lib/tasks/implement-prompt";
import { SkillAgentDialog } from "@/components/tasks/SkillAgentDialog";

export function ImplementTaskDialog({
  open,
  task,
  date,
  onClose,
  cwd,
  repoName: hubRepoName,
}: {
  open: boolean;
  task: Task;
  date: string;
  onClose: () => void;
  /** Hub checkout — wins over the plan URL when set. */
  cwd?: string;
  repoName?: string;
}) {
  const repoLinks = task.links?.filter((link) => link.kind === "repo") ?? [];
  const inferred = repoLinks.length === 1 ? repoLinks[0]?.id : undefined;
  const repoName = hubRepoName ?? inferred;

  const promptInput = (): TaskImplementPromptInput => ({
    origin: typeof window === "undefined" ? "" : window.location.origin,
    taskId: task.id,
    date,
    repoName,
    cwd,
    jiraKey: task.jiraKey,
  });

  return (
    <SkillAgentDialog
      open={open}
      onClose={onClose}
      title="Implement with agent"
      description="Choose the CLI for this task. Leave model blank to use that CLI's default."
      getPrompt={() => buildTaskImplementPrompt(promptInput())}
      cwd={cwd}
      repoName={repoName}
      summary={`Implement ${task.text}`}
      reason={`Implement DevHub task ${task.id}`}
      resolveCwd={
        cwd
          ? undefined
          : async () => {
              const planResponse = await fetch(taskImplementPlanUrl(promptInput()), { cache: "no-store" });
              const plan = (await planResponse.json().catch(() => ({}))) as {
                error?: string;
                repoPath?: string | null;
              };
              if (!planResponse.ok) throw new Error(plan.error || "Couldn't load the task implementation plan");
              return plan.repoPath ?? undefined;
            }
      }
    />
  );
}
