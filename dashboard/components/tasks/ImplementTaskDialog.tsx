"use client";

import { useMemo, useState } from "react";
import type { Task } from "@/lib/tasks/types";
import {
  buildTaskImplementPrompt,
  taskImplementPlanUrl,
  type TaskImplementPromptInput,
} from "@/lib/tasks/implement-prompt";
import { SkillAgentDialog } from "@/components/tasks/SkillAgentDialog";
import {
  ImplementReadyPanel,
  readLocalImplementHardBlock,
  writeLocalImplementHardBlock,
  type ImplementReadyApiResponse,
} from "@/components/tasks/ImplementReadyPanel";
import { useLive } from "@/lib/hooks/use-fetch";

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
  const repoIds = repoLinks.map((l) => l.id);
  const inferred = repoLinks[0]?.id;

  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(
    repoIds.length === 1 ? repoIds[0]! : null,
  );
  const [hardBlockLocal, setHardBlockLocal] = useState(readLocalImplementHardBlock);

  const effectiveRepoId = hubRepoName ?? selectedRepoId ?? (repoIds.length === 1 ? inferred : null);
  const repoName = effectiveRepoId ?? undefined;

  const readyKey = useMemo(() => {
    if (!open) return null;
    const params = new URLSearchParams({ taskId: task.id, date });
    if (selectedRepoId) params.set("selectedRepoId", selectedRepoId);
    if (hubRepoName) params.set("hubRepoId", hubRepoName);
    if (hardBlockLocal) params.set("hardBlock", "1");
    return `/api/tasks/implement/ready?${params.toString()}`;
  }, [open, task.id, date, selectedRepoId, hubRepoName, hardBlockLocal]);

  const { data: ready, isLoading: readyLoading } = useLive<ImplementReadyApiResponse>(readyKey, {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });

  const promptInput = (): TaskImplementPromptInput => ({
    origin: typeof window === "undefined" ? "" : window.location.origin,
    taskId: task.id,
    date,
    repoName,
    cwd,
    jiraKey: task.jiraKey,
  });

  const launchBlocked = Boolean((ready?.blocked || (hardBlockLocal && ready && !ready.ok)));

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
      taskId={task.id}
      launchDisabled={launchBlocked}
      launchDisabledReason="Fix the ready checklist (hard-block is on) before launching."
      banner={
        <ImplementReadyPanel
          loading={readyLoading}
          ready={ready ?? null}
          repoIds={repoIds}
          selectedRepoId={selectedRepoId}
          onSelectRepo={setSelectedRepoId}
          hardBlockLocal={hardBlockLocal}
          onHardBlockLocal={(value) => {
            writeLocalImplementHardBlock(value);
            setHardBlockLocal(value);
          }}
        />
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
              if (!planResponse.ok) throw new Error(plan.error || "Couldn't load the task implementation plan");
              return plan.repoPath ?? undefined;
            }
      }
    />
  );
}
