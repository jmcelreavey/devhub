"use client";

import { openNoteInPanel, wantsFullPage } from "@/lib/notes/open-in-panel";
import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { Ban, Bot, CheckCircle2, ClipboardCopy, FilePen, Flag, Hand, LayoutGrid, Rocket, RotateCcw, SkipForward, Undo2, Wrench, X, Zap } from "lucide-react";
import type { ContextMenuItem } from "@/components/shell/ContextMenu";
import { HoverTip } from "@/components/ui/HoverTip";
import { TaskUpstartButton, useTaskUpstart } from "@/components/tasks/TaskUpstartButton";
import { ImplementTaskDialog } from "@/components/tasks/ImplementTaskDialog";
import { PlanTaskDialog } from "@/components/tasks/PlanTaskDialog";
import { ResumeTaskDialog } from "@/components/tasks/ResumeTaskDialog";
import { useVaultNoteExists } from "@/components/EntityNoteAction";
import { taskNotePath } from "@/lib/task-note";
import { vaultNoteHref } from "@/lib/create-vault-note";
import { usePrStatusMenu } from "@/components/github/PrStatusMenu";
import { openInBrowser } from "@/lib/desktop/bridge";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useToast } from "@/lib/hooks/use-toast";
import { taskImplementPlanUrl } from "@/lib/tasks/implement-prompt";
import {
  agentChatHrefForRun,
  canResumeTaskAgentRun,
  taskAgentChipForLatestRun,
} from "@/lib/tasks/task-agent-resume";
import { isTaskReadyForAgent, type Task } from "@/lib/tasks/types";
import { TASK_AGENT_RUNS_KEY, useTaskAgentRuns } from "@/lib/tasks/use-task-agent-runs";
import { AutoModeSwitch, switchAutoMode } from "@/components/storyboard/AutoModeSwitch";
import { StartAutoDialog } from "@/components/storyboard/StartAutoDialog";
import { type ModelTierSettings } from "@/lib/storyboard/model-tiers-shared";
import { saveModelTiers, useModelTiers } from "@/lib/storyboard/use-model-tiers";
import { canSwitchMode, isManual, isOrchestrating, orchestrationChip, storyboardHrefForTask } from "@/lib/storyboard/orchestration";
import { ORCHESTRATIONS_KEY, useTaskOrchestration } from "@/lib/storyboard/use-orchestrations";
import { startAuto } from "@/app/storyboard/board-actions";
import { runTaskAction, useTaskActionPending } from "@/lib/storyboard/task-action";

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
  onAutoStarted,
}: {
  task: Task;
  date: string;
  cwd?: string;
  repoName?: string;
  /** False for read-only / inactive rows. */
  enabled: boolean;
  onComplete: () => void;
  onAbandon: (reason?: string) => void;
  onAutoStarted?: () => void;
}): { chip: ReactNode; upstart: ReactNode; menuItems: ContextMenuItem[]; dialogs: ReactNode; startAction?: ContextMenuItem } {
  const toast = useToast();
  const router = useRouter();
  const taskRepo = repoName || task.links?.find((link) => link.kind === "repo")?.id.split("/").at(-1);
  const upstart = useTaskUpstart(task.id, taskRepo);
  const { latestRun, handoff } = useTaskAgentRuns(task.id, enabled);
  const [dialog, setDialog] = useState<"implement" | "implement-auto" | "resume" | "plan" | "auto" | null>(null);
  const open = enabled && !task.done;
  const isDraft = task.stage === "draft";
  const agentChip = taskAgentChipForLatestRun(latestRun);
  const attention = latestRun?.attention;
  const showPrMenu = Boolean(
    agentChip?.prUrl && agentChip.kind !== "running" && agentChip.kind !== "paused" && agentChip.kind !== "ready",
  );
  const prMenu = usePrStatusMenu(
    showPrMenu && agentChip?.prUrl
      ? {
          url: agentChip.prUrl,
          branch: latestRun?.branch,
          localRepoName: taskRepo ?? null,
          checks: attention?.kind === "ci-failing" ? "failing" : null,
        }
      : null,
  );
  const prBind = showPrMenu ? prMenu.bind : {};
  const canResume = Boolean(attention) || canResumeTaskAgentRun(latestRun?.status, latestRun?.sessionId);
  const notePath = taskNotePath({ ...task, date });
  const noteExists = useVaultNoteExists(notePath);
  const orchestration = useTaskOrchestration(task.id, enabled);
  const onAuto = orchestration !== null && isOrchestrating(orchestration.status);
  // A start that never got a run (no repo found, or Paseo refused) can be retried from the same item.
  const canRetryAuto = onAuto && orchestration.runCount === 0 && (orchestration.status === "paused" || orchestration.status === "needs-you");
  const [startingAuto, setStartingAuto] = useState(false);
  const pending = useTaskActionPending(task.id);
  const tierDefaults = useModelTiers(enabled && open);

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

  const startOnAuto = useCallback((tiers?: ModelTierSettings, saveAsDefaults = false, pauseAfterPlan?: boolean) => runTaskAction(task.id, "start-auto-ui", async () => {
    if (pending) return { ok: false };
    setStartingAuto(true);
    try {
      if (tiers && saveAsDefaults && !(await saveModelTiers(tiers))) toast.error("Couldn't save the tiers as defaults; starting with them anyway.");
      const result = await startAuto({ taskId: task.id, date }, {
        ...(cwd ? { cwd } : {}),
        ...(repoName ? { repoName } : {}),
        ...(tiers ? { tiers } : {}),
        ...(pauseAfterPlan !== undefined ? { pauseAfterPlan } : {}),
      });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't start the task on auto");
        return result;
      }
      const summary = result.summary;
      if (summary?.status === "needs-you") toast.info("On auto, but it needs you: which repo should it run in?");
      else if (summary?.status === "paused") toast.error(`On auto, but planning didn't start: ${summary.lastError ?? "unknown error"}`);
      else toast.success(result.runId ? "On auto: planning started" : "Already on auto");
      void mutate(ORCHESTRATIONS_KEY);
      void mutate(TASK_AGENT_RUNS_KEY);
      setDialog(null);
      if (onAutoStarted) onAutoStarted();
      else router.push(storyboardHrefForTask(task.id));
      return result;
    } catch {
      toast.error("Couldn't confirm the start. Refresh Tasks before retrying.");
      void mutate(ORCHESTRATIONS_KEY);
      return { ok: false };
    } finally {
      setStartingAuto(false);
    }
  }), [pending, task.id, date, cwd, repoName, toast, router, onAutoStarted]);

  const item = (id: string, label: string, icon: ReactNode, onSelect: () => void): ContextMenuItem => ({
    id,
    label,
    icon,
    onSelect,
  });

  const menuItems: ContextMenuItem[] = [];
  if (enabled && taskRepo) {
    menuItems.push({
      id: "upstart", label: upstart.busy ? "Preparing checkout…" : "Upstart",
      description: "Start this task’s checkout",
      icon: <Rocket size={12} aria-hidden />, disabled: upstart.busy,
      onSelect: upstart.start,
    });
  }
  if (open) {
    // Drafts always offer planning (capture already creates their note); past
    // draft, only while the task has no note yet.
    if (isDraft || !noteExists) {
      menuItems.push(item("plan-agent", "Write plan with Agent…", <FilePen size={12} aria-hidden />, () => setDialog("plan")));
    }
    if (isDraft) {
      menuItems.push(item("mark-ready", "Mark ready for an agent", <Flag size={12} aria-hidden />, () => void setStage("ready")));
    } else if (isTaskReadyForAgent(task)) {
      // A manual run beside a live auto run leaves auto still waiting on the old step, so auto owns implementation until it's paused.
      menuItems.push(onAuto
        ? { id: "implement-agent", label: "Implement with Agent…", description: "Retry on auto or switch to manual first.", icon: <Bot size={12} aria-hidden />, disabled: true, onSelect: () => undefined }
        : item("implement-agent", "Implement with Agent…", <Bot size={12} aria-hidden />, () => setDialog("implement")));
    }
    if (!onAuto || canRetryAuto) {
      menuItems.push({
        id: "start-auto",
        label: startingAuto ? "Starting on auto…" : canRetryAuto ? "Retry on auto" : "Start on auto",
        // Opens the launch sheet with Run on auto checked, so the model, instructions and worktree can change before it runs.
        description: "Review launch; pause after planning.",
        icon: <Zap size={12} aria-hidden />,
        disabled: startingAuto || pending,
        onSelect: () => (canRetryAuto ? void startOnAuto(undefined, false, true) : setDialog("implement-auto")),
      });
      menuItems.push({ id: "start-auto-without-review", label: "Run without plan review", description: "Plan, then implement without pausing.", icon: <SkipForward size={12} aria-hidden />, disabled: startingAuto || pending, onSelect: () => void startOnAuto(undefined, false, false) });
      if (tierDefaults) {
        menuItems.push({
          id: "start-auto-tiers",
          label: "Start on auto with other tiers…",
          description: "Choose and optionally save step tiers.",
          icon: <Zap size={12} aria-hidden />,
          disabled: startingAuto || pending,
          onSelect: () => setDialog("auto"),
        });
      }
    }
    if (canResume) {
      const label = attention ? "Fix PR with Agent…" : latestRun?.status === "done" ? "Continue with Agent…" : "Resume with Agent…";
      menuItems.push(item("resume-agent", label, attention ? <Wrench size={12} aria-hidden /> : <RotateCcw size={12} aria-hidden />, () => setDialog("resume")));
    }
    if (attention) {
      menuItems.push(item("dismiss-attention", "Dismiss PR alert", <X size={12} aria-hidden />, () => void dismissAttention()));
    }
    if (latestRun?.prState === "merged") {
      const live = latestRun.status === "running" || latestRun.status === "queued" || orchestration?.status === "running" || orchestration?.status === "starting";
      menuItems.push({ ...item("complete-merged", "Finish", <CheckCircle2 size={12} aria-hidden />, onComplete), disabled: pending || live, disabledReason: live ? "Wait for the run to finish or stop it first" : undefined });
    }
    if (latestRun?.prState === "closed") {
      menuItems.push({ ...item("abandon-closed", "Abandon task (PR closed)", <Ban size={12} aria-hidden />, () => onAbandon("PR closed without merging")), danger: true });
    }
    if (!isDraft && !latestRun) {
      menuItems.push(item("mark-draft", "Move back to draft", <Undo2 size={12} aria-hidden />, () => void setStage("draft")));
    }
  }
  if (enabled && orchestration && canSwitchMode(orchestration)) {
    const manual = isManual(orchestration);
    menuItems.push({
      id: "auto-mode",
      label: manual ? "Resume on auto" : "Switch to manual",
      description: manual ? "Auto starts a fresh run." : "Stop the run and take over.",
      icon: manual ? <Zap size={12} aria-hidden /> : <Hand size={12} aria-hidden />,
      onSelect: () => void switchAutoMode(task.id, manual ? "auto" : "manual", toast),
    });
  }
  if (enabled && orchestration) {
    menuItems.push(item("storyboard", "Open on Storyboard", <LayoutGrid size={12} aria-hidden />, () => router.push(storyboardHrefForTask(task.id))));
  }
  if (enabled) {
    menuItems.push(item("workflow", "Checks and evidence", <CheckCircle2 size={12} aria-hidden />, () => router.push("/storyboard?task=" + encodeURIComponent(task.id) + "&taskSection=evidence")));
    menuItems.push(item("copy-plan", "Copy plan as markdown", <ClipboardCopy size={12} aria-hidden />, () => void copyPlan()));
  }

  const stop = (e: MouseEvent) => e.stopPropagation();
  let chip: ReactNode = null;
  if (agentChip) {
    const icon = agentChip.kind === "attention" ? <Wrench size={11} aria-hidden /> : <Bot size={11} aria-hidden />;
    const tip = [
      agentChip.detail ?? (agentChip.prUrl ? agentChip.prUrl : `Agent run ${agentChip.runId}`),
      showPrMenu ? "Right-click for PR actions" : null,
    ]
      .filter(Boolean)
      .join(" · ");
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
            {...prBind}
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
            {...prBind}
          >
            {icon}
            {agentChip.label}
          </a>
        ) : (
          <Link
            href={agentChatHrefForRun(agentChip.runId)}
            className="task-agent-chip"
            data-kind={agentChip.kind}
            onClick={stop}
            aria-label={`${agentChip.label} — open agent chat`}
          >
            {icon}
            {agentChip.label}
          </Link>
        )}
      </HoverTip>
    );
  } else if (isDraft && open) {
    chip = (
      <HoverTip label={noteExists ? "Open draft note" : "Captured idea — write a plan before handing it to an agent"} pos="top-end">
        {noteExists ? (
          <Link
            href={vaultNoteHref(notePath)}
            className="task-agent-chip"
            data-kind="draft"
            onClick={(event) => {
              stop(event);
              if (wantsFullPage(event)) return;
              event.preventDefault();
              openNoteInPanel(notePath);
            }}
            aria-label="Open draft note"
          >
            <FilePen size={11} aria-hidden />
            Draft
          </Link>
        ) : (
          <span className="task-agent-chip" data-kind="draft">
            <FilePen size={11} aria-hidden />
            Draft
          </span>
        )}
      </HoverTip>
    );
  }

  const autoChip = enabled && orchestration ? orchestrationChip(orchestration) : null;
  if (autoChip && orchestration) {
    chip = (
      <>
        <HoverTip label={autoChip.detail}>
          <Link
            href={storyboardHrefForTask(task.id)}
            className="task-agent-chip"
            data-kind={autoChip.kind}
            onClick={stop}
            aria-label={`${autoChip.label} — open on Storyboard`}
          >
            <Zap size={11} aria-hidden />
            {autoChip.label}
          </Link>
        </HoverTip>
        <AutoModeSwitch summary={orchestration} compact />
        {chip}
      </>
    );
  }

  const close = () => setDialog(null);
  const dialogs = (
    <>
      {showPrMenu ? prMenu.menuNode : null}
      {enabled ? (
        <>
          <ImplementTaskDialog open={dialog === "implement" || dialog === "implement-auto"} autoByDefault={dialog === "implement-auto"} task={task} date={date} cwd={cwd} repoName={repoName} onClose={close} />
          <PlanTaskDialog open={dialog === "plan"} task={task} date={date} cwd={cwd} repoName={repoName} onClose={close} />
          {dialog === "auto" && tierDefaults ? (
            <StartAutoDialog open settings={tierDefaults} busy={startingAuto} onClose={close} onStart={(tiers, save, pause) => void startOnAuto(tiers, save, pause)} />
          ) : null}
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
      ) : null}
    </>
  );

  const startAction = !latestRun && !orchestration ? menuItems.find((entry) => entry.id === "start-auto") : undefined;
  return { chip, upstart: enabled && taskRepo ? <TaskUpstartButton {...upstart} /> : null, menuItems, dialogs, startAction };
}
