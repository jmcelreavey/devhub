"use client";

import { ContextMenu, type ContextMenuPosition } from "@/components/shell/ContextMenu";
import { groupTaskMenu } from "@/components/tasks/taskMenuGroups";
import { useTaskMenu } from "@/components/tasks/useTaskMenu";
import { TaskLinkButton } from "@/components/TaskLinkButton";
import { requestTaskNote } from "@/components/tasks/AddNoteComposer";
import { useTaskDetail } from "@/components/storyboard/TaskDetailProvider";
import { useTeamTaskActions } from "@/components/storyboard/TeamTaskActions";
import { useTaskActionPending } from "@/lib/storyboard/task-action";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { useHomeTaskActions } from "./useHomeTaskActions";
import { useHomeTaskJiraMenu } from "./useHomeTaskJiraMenu";
import { mutate } from "swr";
import { ArrowRightLeft, ClipboardCopy, FileText, MessageSquare, RotateCcw, Undo2, X } from "lucide-react";
import { recoverCardFailure } from "@/app/storyboard/board-actions";
import { useToast } from "@/lib/hooks/use-toast";
import { buildTaskReviewMessage, copyTextAndToast } from "@/lib/pr-slack";
import { hasLiveWork } from "@/lib/storyboard/next-action";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";

export function HomeTaskCardMenu({ card, profile, open, position, onClose, onStartEdit, onEdit }: {
  card: BoardCard; profile?: string; open: boolean; position: ContextMenuPosition | null; onClose: () => void;
  onStartEdit?: () => void; onEdit?: (text: string) => void;
}) {
  const detail = useTaskDetail();
  const team = useTeamTaskActions(card, profile);
  const actions = useHomeTaskActions(card, profile);
  const jiraMenu = useHomeTaskJiraMenu(card, profile);
  const pending = useTaskActionPending(card.taskId, profile);
  const toast = useToast();
  const recover = async (action: "retry" | "clear" | "restore") => {
    const result = await recoverCardFailure(card, action, profile);
    if (!result.ok) toast.error(result.error ?? "Couldn't update the failure.");
    else toast.success(action === "clear" ? "Failure cleared. Auto stays paused." : action === "restore" ? "Failure restored." : "Retrying failed step.", action === "clear" ? { duration: 7000, action: { label: "Undo", onClick: () => recover("restore") } } : undefined);
    await mutate((key) => typeof key === "string" && ["/api/storyboard", "/api/tasks", "/api/sidebar/counts"].some((prefix) => key.startsWith(prefix)));
  };
  const task = card.task ?? { id: card.taskId, text: card.title, done: card.taskDone, startDate: card.date, createdAt: card.updatedAt, rank: card.rank ?? "a0" };
  const readOnly = isTaskOwnershipBlocked(task);
  const shared = useTaskMenu({ task, date: card.date, repoName: card.repo, inactive: readOnly || !!(task.abandonedAt || task.endDate || task.movedAt), menuOpen: open, pending, notePath: card.notePath ?? undefined, handlers: {
    onToggle: actions.complete, onComplete: actions.complete, onAbandon: (reason) => void actions.close(reason),
    onStartEdit, onEdit,
    onOpenNote: () => detail?.openTask(card.taskId, "note"),
    onAddNote: () => requestTaskNote(card.taskId),
  } });
  const failureGroups = card.failure ? [{ id: "failure", items: [
    { id: "failure-retry", label: "Retry", icon: <RotateCcw size={12} aria-hidden />, disabled: pending || hasLiveWork(card), onSelect: () => void recover("retry") },
    { id: "failure-guidance", label: "Resume with guidance", icon: <MessageSquare size={12} aria-hidden />, onSelect: () => detail?.openTask(card.taskId, "guidance") },
    { id: "failure-logs", label: "Open logs", icon: <FileText size={12} aria-hidden />, onSelect: () => detail?.openTask(card.taskId, "logs") },
    { id: "failure-clear", label: card.failure.cleared ? "Undo clear" : "Clear failure", icon: card.failure.cleared ? <Undo2 size={12} aria-hidden /> : <X size={12} aria-hidden />, disabled: pending, onSelect: () => void recover(card.failure?.cleared ? "restore" : "clear") },
  ] }] : [];
  const slackGroups = card.status === "ready-for-review" ? [{ id: "slack-review", items: [{ id: "copy-slack", label: "Copy Slack message", icon: <ClipboardCopy size={12} aria-hidden />, description: "Request review with PR and Jira links", onSelect: () => void copyTextAndToast(buildTaskReviewMessage(card), "Slack message", toast) }] }] : [];
  const teamGroups = team.groups.map((group) => ({
    ...group,
    label: "Team",
    items: group.items.map((item) => ({
      ...item,
      icon: item.icon ?? (item.id === "team-handoff" ? <ArrowRightLeft size={12} aria-hidden /> : <MessageSquare size={12} aria-hidden />),
    })),
  }));
  const groups = readOnly ? [{ id: "read-only", items: [{ id: "open", label: "Open note", icon: <FileText size={12} aria-hidden />, onSelect: () => detail?.openTask(card.taskId, "note") }] }] : [...failureGroups, ...slackGroups, ...actions.groups([...shared.groups, ...jiraMenu.groups]), ...teamGroups];
  return <><ContextMenu open={open} position={position} groups={groupTaskMenu(groups)} onClose={onClose} label={`${card.title} actions`} />{!readOnly ? <>
    <TaskLinkButton taskId={task.id} date={card.date} profile={profile} existing={task.links}
      open={shared.linkOpen} onOpenChange={shared.setLinkOpen} showTrigger={false}
      onChanged={() => { void mutate((key) => typeof key === "string" && ["/api/tasks", "/api/storyboard", "/api/entity-links"].some((prefix) => key.startsWith(prefix))); }} />
    {shared.dialogs}{jiraMenu.dialogs}{team.dialogs}
  </> : null}</>;
}
