"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { mutate } from "swr";
import { Ban, Bot, CheckCircle2, ClipboardCopy, FilePen, Flag, RotateCcw, Undo2, Wrench, X } from "lucide-react";
import type { ContextMenuItem } from "@/components/shell/ContextMenu";
import { HoverTip } from "@/components/ui/HoverTip";
import { ImplementTaskDialog } from "@/components/tasks/ImplementTaskDialog";
import { PlanTaskDialog } from "@/components/tasks/PlanTaskDialog";
import { ResumeTaskDialog } from "@/components/tasks/ResumeTaskDialog";
import { useVaultNoteExists } from "@/components/EntityNoteAction";
import { taskNotePath } from "@/lib/task-note";
import { openInBrowser } from "@/lib/desktop/bridge";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useToast } from "@/lib/hooks/use-toast";
import { taskImplementPlanUrl } from "@/lib/tasks/implement-prompt";
import {
  agentActivityHrefForRun,
  canResumeTaskAgentRun,
  taskAgentChipForLatestRun,
} from "@/lib/tasks/task-agent-resume";
import { isTaskReadyForAgent, type Task } from "@/lib/tasks/types";
import { TASK_AGENT_RUNS_KEY, useTaskAgentRuns } from "@/lib/tasks/use-task-agent-runs";

const refreshTasks = () =>
  mutate((key) => typeof key === "string" && key.startsWith("/api/tasks"), undefined, { revalidate: true });

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/**
 * Everything a task row does with agents and plans: the status chip, the
 * draft → ready → implement → PR → merged menu items, and their dialogs.
 */
export function useTaskAgentActions({
  task,
  date,
  cwd,
  repoName,
  enabled,
  onComplete,
  onAbandon,
}: {
  task: Task;
  date: string;
  cwd?: string;
  repoName?: string;
  /** False for read-only / inactive rows. */
  enabled: boolean;
  onComplete: () => void;
  onAbandon: (reason?: string) => void;
}): { chip: ReactNode; menuItems: ContextMenuItem[]; dialogs: ReactNode } {
  const toast = useToast();
  const { latestRun, handoff } = useTaskAgentRuns(task.id, enabled);
  const [dialog, setDialog] = useState<"implement" | "resume" | "plan" | null>(null);
  const open = enabled && !task.done;
  const isDraft = task.stage === "draft";
  const agentChip = taskAgentChipForLatestRun(latestRun);
  const attention = latestRun?.attention;
  const canResume = Boolean(attention) || canResumeTaskAgentRun(latestRun?.status, latestRun?.sessionId);
  const noteExists = useVaultNoteExists(taskNotePath({ id: task.id, text: task.text, date, jiraKey: task.jiraKey }));

  const setStage = async (stage: "draft" | "ready", force = false) => {
    const { ok, json } = await postJson("/api/tasks/stage", { taskId: task.id, date, stage, force });
    if (ok) {
      toast.success(stage === "ready" ? "Ready for an agent" : "Moved back to draft");
      void refreshTasks();
      return;
    }
    toast.error(String(json.error ?? "Couldn't change the task stage"), {
      ...(stage === "ready" && !force
        ? { action: { label: "Mark anyway", onClick: () => void setStage("ready", true) } }
        : {}),
    });
  };

  const dismissAttention = async () => {
    if (!latestRun) return;
    const { ok } = await postJson("/api/tasks/agent-runs/attention", { taskId: task.id, runId: latestRun.runId });
    if (!ok) toast.error("Couldn't dismiss the PR alert");
    void mutate(TASK_AGENT_RUNS_KEY);
  };

  const copyPlan = async () => {
    try {
      const url = `${taskImplementPlanUrl({ origin: window.location.origin, taskId: task.id, date })}&format=markdown`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      await copyTextToClipboard(await res.text());
      toast.success("Plan copied as markdown");
    } catch {
      toast.error("Couldn't copy the plan");
    }
  };

  const item = (id: string, label: string, icon: ReactNode, onSelect: () => void): ContextMenuItem => ({
    id,
    label,
    icon,
    onSelect,
  });

  const menuItems: ContextMenuItem[] = [];
  if (open) {
    // Drafts always offer planning (capture already creates their note); past
    // draft, only while the task has no note yet.
    if (isDraft || !noteExists) {
      menuItems.push(item("plan-agent", "Write plan with Agent…", <FilePen size={12} aria-hidden />, () => setDialog("plan")));
    }
    if (isDraft) {
      menuItems.push(item("mark-ready", "Mark ready for an agent", <Flag size={12} aria-hidden />, () => void setStage("ready")));
    } else if (isTaskReadyForAgent(task)) {
      menuItems.push(item("implement-agent", "Implement with Agent…", <Bot size={12} aria-hidden />, () => setDialog("implement")));
    }
    if (canResume) {
      const label = attention ? "Fix PR with Agent…" : latestRun?.status === "done" ? "Continue with Agent…" : "Resume with Agent…";
      menuItems.push(item("resume-agent", label, attention ? <Wrench size={12} aria-hidden /> : <RotateCcw size={12} aria-hidden />, () => setDialog("resume")));
    }
    if (attention) {
      menuItems.push(item("dismiss-attention", "Dismiss PR alert", <X size={12} aria-hidden />, () => void dismissAttention()));
    }
    if (latestRun?.prState === "merged") {
      menuItems.push(item("complete-merged", "Complete task (PR merged)", <CheckCircle2 size={12} aria-hidden />, onComplete));
    }
    if (latestRun?.prState === "closed") {
      menuItems.push(item("abandon-closed", "Abandon task (PR closed)", <Ban size={12} aria-hidden />, () => onAbandon("PR closed without merging")));
    }
    if (!isDraft && !latestRun) {
      menuItems.push(item("mark-draft", "Move back to draft", <Undo2 size={12} aria-hidden />, () => void setStage("draft")));
    }
  }
  if (enabled) {
    menuItems.push(item("copy-plan", "Copy plan as markdown", <ClipboardCopy size={12} aria-hidden />, () => void copyPlan()));
  }

  const stop = (e: MouseEvent) => e.stopPropagation();
  let chip: ReactNode = null;
  if (agentChip) {
    const icon = agentChip.kind === "attention" ? <Wrench size={11} aria-hidden /> : <Bot size={11} aria-hidden />;
    const tip = agentChip.detail ?? (agentChip.prUrl ? agentChip.prUrl : `Agent run ${agentChip.runId}`);
    chip = (
      <HoverTip label={tip}>
        {agentChip.kind === "attention" && open ? (
          <button
            type="button"
            className="task-agent-chip"
            data-kind={agentChip.kind}
            onClick={(e) => {
              stop(e);
              setDialog("resume");
            }}
            aria-label={`${agentChip.label} — send the agent back to fix it`}
          >
            {icon}
            {agentChip.label}
          </button>
        ) : agentChip.prUrl && agentChip.kind !== "running" ? (
          <a
            href={agentChip.prUrl}
            className="task-agent-chip"
            data-kind={agentChip.kind}
            onClick={(e) => {
              e.preventDefault();
              stop(e);
              void openInBrowser(agentChip.prUrl!);
            }}
            aria-label={`${agentChip.label} — open the pull request`}
          >
            {icon}
            {agentChip.label}
          </a>
        ) : (
          <Link
            href={agentActivityHrefForRun(agentChip.runId)}
            className="task-agent-chip"
            data-kind={agentChip.kind}
            onClick={stop}
            aria-label={`${agentChip.label} — open agent activity`}
          >
            {icon}
            {agentChip.label}
          </Link>
        )}
      </HoverTip>
    );
  } else if (isDraft && open) {
    chip = (
      <HoverTip label="Captured idea — write a plan before handing it to an agent">
        <span className="task-agent-chip" data-kind="draft">
          <FilePen size={11} aria-hidden />
          Draft
        </span>
      </HoverTip>
    );
  }

  const close = () => setDialog(null);
  const dialogs = enabled ? (
    <>
      <ImplementTaskDialog open={dialog === "implement"} task={task} date={date} cwd={cwd} repoName={repoName} onClose={close} />
      <PlanTaskDialog open={dialog === "plan"} task={task} date={date} cwd={cwd} repoName={repoName} onClose={close} />
      <ResumeTaskDialog
        open={dialog === "resume"}
        task={task}
        date={date}
        latestRun={latestRun}
        handoff={handoff}
        cwd={cwd}
        repoName={repoName}
        onClose={close}
      />
    </>
  ) : null;

  return { chip, menuItems, dialogs };
}
