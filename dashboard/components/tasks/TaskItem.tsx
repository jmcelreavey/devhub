"use client";

/**
 * A single task row: inline edit, timer, Jira chip, abandon/reactivate.
 *
 * Extracted from TaskList.tsx (R11), which was 1,406 lines containing the
 * list, the row, the row's sub-parts and a pile of pure string helpers. The
 * row is the piece other pages reach for on its own - /tasks renders TaskItem
 * without the list around it - so it earns its own module.
 */
import { useState, useEffect, useRef, type HTMLAttributes } from "react";
import { type Task } from "@/lib/tasks/types";
import { TaskTextContent } from "@/components/tasks/TaskText";
import { stripLinkedJiraKeyFromText } from "@/lib/tasks/task-text";
import { entityKey } from "@/lib/entity-note";
import { statusTone } from "@/components/jira/JiraWidget";
import {
  Circle,
  CheckCircle2,
  Ban,
  ArrowRight,
  GripVertical,
  FileText,
  Link2,
} from "lucide-react";
import { JiraKeyChip, JiraParentChip } from "@/components/jira/JiraKeyChip";
import type { JiraTicketRef } from "@/lib/jira/client";
import { JiraStatusPill } from "@/components/jira/JiraStatusPill";
import { HoverTip } from "@/components/ui/HoverTip";
import { SeverityPill } from "@/components/ui/Severity";
import { useSecondTick } from "@/lib/tickers";
import { formatDuration, todayISO } from "@/lib/utils";
import { SharedEntityChips, isRedundantChip } from "@/components/EntityLinkChips";
import { TaskLinkButton } from "@/components/TaskLinkButton";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
  type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import { mutate } from "swr";
import type { EntityRef } from "@/lib/entity-note";
import { useTaskMenu } from "@/components/tasks/useTaskMenu";
import { useTaskActionPending } from "@/lib/storyboard/task-action";
import { useTaskDetail } from "@/components/storyboard/TaskDetailProvider";
import { WorkActionButton } from "@/components/storyboard/WorkActionButton";
import { useWorkAction } from "@/components/storyboard/useWorkAction";
import { type NextAction } from "@/lib/storyboard/next-action";
import { resolveWorkPresentation } from "@/lib/storyboard/work-summary";

/** Repo chips shown in the rail before "+N"; the links button holds the full set. */
const REPO_CHIPS_IN_RAIL = 1;

interface JiraStatus {
  name: string;
  parent?: JiraTicketRef | null;
}

export function TaskItem({
  task,
  date,
  jiraStatus,
  readOnly = false,
  onToggle,
  onDelete,
  onEdit,
  onAbandon,
  onReactivate,
  onAddToJira,
  onStatusClick,
  onTimer,
  dragHandleProps,
  isDragging = false,
  isDropTarget = false,
  cwd,
  repoName,
  suppressLinks,
  showUpstart = false,
  hideJiraKey = false,
  hideParent = false,
  showStartAuto = false,
  showWorkStatus = false,
  menuGroups,
  pending = false,
}: {
  task: Task;
  /** Day file this task lives in (YYYY-MM-DD). Defaults to today. */
  date?: string;
  jiraStatus?: JiraStatus;
  readOnly?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: (text: string) => void;
  onAbandon: (reason?: string) => void;
  onReactivate?: () => void;
  onAddToJira?: () => void;
  onStatusClick?: () => void;
  onTimer?: () => void;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement> & { draggable: boolean };
  isDragging?: boolean;
  isDropTarget?: boolean;
  /** Hub checkout — Implement launches here instead of guessing from the plan. */
  cwd?: string;
  repoName?: string;
  /** Links the surrounding list already shows once in its header. */
  suppressLinks?: readonly EntityRef[];
  /** Repository task lists expose startup; other surfaces use the context menu. */
  showUpstart?: boolean;
  /** The surrounding ticket group already identifies this task. */
  hideJiraKey?: boolean;
  /** The surrounding group already names the parent. */
  hideParent?: boolean;
  showStartAuto?: boolean;
  showWorkStatus?: boolean;
  menuGroups?: ContextMenuGroup[];
  pending?: boolean;
}) {
  const menu = useContextMenu<Task>();
  const taskDate = date ?? todayISO();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(task.text);
  const [showAbandon, setShowAbandon] = useState(false);
  const [abandonReason, setAbandonReason] = useState("");
  // True only in the moment the user just checked the box, so the confetti
  // burst fires on completion — not when an already-done list renders.
  const [justCompleted, setJustCompleted] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  const isAbandoned = !!task.abandonedAt;
  const isMoved = !!task.movedAt || task.endReason === "legacy-moved";
  const slipped = !isMoved && !task.done && !task.abandonedAt && !!task.startDate && task.startDate < taskDate;
  const isInactive = isAbandoned || isMoved || readOnly;
  const detail = useTaskDetail();
  const taskPending = useTaskActionPending(task.id, detail?.profileId);
  const actionPending = pending || taskPending;
  const perform = useWorkAction(detail?.profileId);
  const workCard = detail?.board?.cards.find((card) => card.taskId === task.id);
  const presentation = workCard ? resolveWorkPresentation(workCard, detail?.workflows.get(task.id), Date.parse(detail?.board?.generatedAt ?? workCard.updatedAt)) : undefined;
  const rowAction = !isInactive && !task.done ? presentation?.action : null;
  const onWorkAction = async (action: NextAction) => {
    if (!workCard) return;
    if (action.kind !== "finish" && action.kind !== "done") detail?.openTask(task.id);
    await perform(workCard, action);
  };

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const saveEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== task.text) {
      onEdit(trimmed);
    } else {
      setEditText(task.text);
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditText(task.text);
    setEditing(false);
  };

  const confirmAbandon = () => {
    onAbandon(abandonReason.trim() || undefined);
    setShowAbandon(false);
    setAbandonReason("");
  };

  const displayText = task.jiraKey
    ? stripLinkedJiraKeyFromText(task.text, task.jiraKey)
    : task.text;

  // Links stored on the task, minus the Jira self-reference the key chip
  // already shows. Repos get an inline chip (the hop people take most);
  // everything else sits behind the links button so the row stays one line.
  const suppressKeys = new Set((suppressLinks ?? []).map(entityKey));
  const rowLinks = ((task.links ?? []) as EntityRef[]).filter(
    (ref) => ref.kind !== "tag" && !isRedundantChip(ref, { suppressJiraKey: task.jiraKey }),
  );
  const repoLinks = rowLinks.filter(
    (ref) => ref.kind === "repo" && !isRedundantChip(ref, { suppressRepo: repoName, suppressKeys }),
  );
  const linkCount = rowLinks.length;


  const textStyle: React.CSSProperties = {
    color: task.done || isInactive ? "var(--text-subtle)" : "var(--text)",
    textDecoration: task.done ? "line-through" : "none",
    opacity: task.done ? 0.6 : isInactive ? 0.45 : 1,
  };

  // The trailing meta cluster (Jira status, timer readout) renders in the
  // fixed action rail so it lines up with the note/links icons across rows;
  // only render it when it has content so plain tasks stay compact.
  // `task.due` is deliberately not shown: nothing in the UI sets it, so a
  // "due" label here was an MCP-only field leaking into every row.
  const showJiraStatus = !!jiraStatus && !task.done && !isAbandoned;
  const parentRef =
    task.jiraKey && !isAbandoned && !editing && !hideJiraKey && !hideParent ? jiraStatus?.parent : null;
  const showTimerReadout = !isInactive && (!!task.timerStartedAt || (task.timeSpentMs ?? 0) > 0);

  const taskMenu = useTaskMenu({
    task,
    date: taskDate,
    cwd,
    repoName,
    inactive: isInactive,
    menuOpen: menu.target !== null,
    extraGroups: menuGroups,
    pending: actionPending,
    notePath: showWorkStatus ? workCard?.notePath ?? undefined : undefined,
    handlers: {
      onToggle,
      onAbandon,
      onRequestAbandon: () => setShowAbandon(true),
      onDelete,
      onEdit,
      onStartEdit: () => {
        setEditing(true);
        setEditText(task.text);
      },
      onTimer,
      onAddToJira,
      onReactivate,
      onOpenNote: showWorkStatus && detail ? () => detail.openTask(task.id, "note") : undefined,
    },
  });
  const { agent, noteExists, openTaskNote, openLinks, linkOpen, setLinkOpen } = taskMenu;


  return (
    <div>
      <div
        className={`task-row flex items-start gap-2.5 group rounded px-2 py-1.5 transition-colors${isDragging ? " row-dragging" : ""}`}
        style={{
          opacity: isDragging ? 0.45 : undefined,
          background: isDropTarget ? "var(--bg-elevated)" : undefined,
          outline: isDropTarget ? "1px solid var(--accent)" : undefined,
        }}
        {...(!editing && !showAbandon ? menu.bindRow(task) : {})}
        onDoubleClick={() => {
          if (isInactive || editing || showAbandon) return;
          setEditing(true);
          setEditText(task.text);
        }}
      >
        {dragHandleProps && !isInactive && !editing && !showAbandon && (
          <HoverTip label="Drag to reorder." pos="top">
            <button
              type="button"
              {...dragHandleProps}
              className="shrink-0 rounded p-0.5 reveal-on-hover focus:opacity-100"
              style={{ color: "var(--text-subtle)", cursor: "grab" }}
              aria-label={`Drag to reorder ${task.text}`}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => {
                // Keep bindRow's long-press from starting on the grip, but still
                // run SortableList's handler — a stopPropagation-only override
                // replaces dragHandleProps.onPointerDown and kills reorder.
                e.stopPropagation();
                dragHandleProps.onPointerDown?.(e);
              }}
            >
              <GripVertical size={14} aria-hidden />
            </button>
          </HoverTip>
        )}
        {isMoved ? (
          <span
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "2px 4px",
            }}
            aria-hidden
          >
            <ArrowRight size={16} style={{ color: "var(--text-subtle)", opacity: 0.5 }} />
          </span>
        ) : isAbandoned ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReactivate?.();
            }}
            aria-label="Reactivate task"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ban size={16} style={{ color: "var(--text-subtle)", opacity: 0.5 }} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!task.done) {
                setJustCompleted(true);
                window.setTimeout(() => setJustCompleted(false), 700);
              }
              onToggle();
            }}
            aria-label={task.done ? "Mark task incomplete" : "Mark task complete"}
            disabled={actionPending || justCompleted}
            className="task-toggle"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {task.done ? (
              <span className={justCompleted ? "check-burst" : "inline-flex"}>
                <CheckCircle2
                  key="done"
                  size={16}
                  className="text-success task-check-pulse"
                  aria-hidden
                />
              </span>
            ) : (
              <Circle size={16} aria-hidden className="text-text-subtle" />
            )}
          </button>
        )}

        <div className="task-row-content flex-1 min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {task.jiraKey && !isAbandoned && !hideJiraKey && <JiraKeyChip jiraKey={task.jiraKey} done={task.done} />}

          {editing ? (
            <input
              ref={editRef}
              className="input"
              style={{ fontSize: "13px", flex: 1, minWidth: 0 }}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  cancelEdit();
                }
              }}
              onBlur={saveEdit}
            />
          ) : (
            <span className="task-row-title text-sm leading-snug" style={textStyle}>
              <TaskTextContent text={task.jiraKey && !isAbandoned ? displayText : task.text} onTextClick={detail && !isMoved ? () => detail.openTask(task.id) : undefined} />
              {slipped ? <span className="ml-2 text-[11px] font-mono text-text-subtle">slipped</span> : null}
            </span>
          )}

          {/* Trails the title: the parent is context, so the row leads with its own key. */}
          {parentRef && <JiraParentChip parent={parentRef} done={task.done} />}

          {isAbandoned && task.abandonReason && (
            <span
              className="text-xs min-w-0 basis-full break-words leading-snug"
              style={{ color: "var(--text-subtle)", opacity: 0.6 }}
            >
              - {task.abandonReason}
            </span>
          )}
          {task.endReason === "legacy-moved" ? (
            <span className="text-xs min-w-0 basis-full break-words leading-snug" style={{ color: "var(--text-subtle)", opacity: 0.6 }}>
              Ended when the later copy was removed
            </span>
          ) : null}

          {showWorkStatus && presentation ? <span className="text-xs text-text-muted basis-full">{presentation.status}</span> : null}

        </div>

        {!editing && !showAbandon && (
          <div className="task-row-actions">
            {showStartAuto && rowAction ? <WorkActionButton action={rowAction} pending={actionPending} onAction={(action) => void onWorkAction(action)} onOpen={detail ? () => detail.openTask(task.id) : undefined} detailHref={detail?.hrefForTask(task.id)} className="task-row-start-auto" /> : null}
            {/* Trailing meta (Jira status, timer) leads the rail so the
                note/links icons keep the same column across rows. */}
            {(showJiraStatus || showTimerReadout || agent.chip || (showUpstart && agent.upstart)) && (
              <div className="task-row-meta">
                {agent.chip}
                {showUpstart && agent.upstart}
                {showJiraStatus && (
                  onStatusClick ? (
                    <span className="task-jira-status" onClick={(e) => e.stopPropagation()}>
                      <JiraStatusPill ticketKey={task.jiraKey!} status={jiraStatus!.name} onChanged={onStatusClick} />
                    </span>
                  ) : (
                    <span className="task-jira-status">
                      <SeverityPill tone={statusTone(jiraStatus!.name)}>{jiraStatus!.name}</SeverityPill>
                    </span>
                  )
                )}
                {!isInactive && <TimerReadout task={task} />}
              </div>
            )}
            {repoLinks.length > 0 ? <SharedEntityChips refs={repoLinks} label="Linked repos" max={REPO_CHIPS_IN_RAIL} /> : null}
            {noteExists ? (
              <HoverTip label="Open note">
                <button
                  type="button"
                  className="row-note-glyph"
                  aria-label="Open note"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void openTaskNote();
                  }}
                >
                  <FileText size={14} aria-hidden />
                </button>
              </HoverTip>
            ) : null}
            <HoverTip label={linkCount > 0 ? `${linkCount} linked` : "Links"}>
              <button
                type="button"
                className="row-menu-kebab task-links-btn shrink-0"
                aria-label={linkCount > 0 ? `View ${linkCount} linked items` : "View links"}
                aria-haspopup="dialog"
                data-linked={linkCount > 0 ? "true" : undefined}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openLinks();
                }}
              >
                <Link2 size={14} aria-hidden />
                {linkCount > 0 ? (
                  <span className="task-links-count" aria-hidden>
                    {linkCount > 9 ? "9+" : linkCount}
                  </span>
                ) : null}
              </button>
            </HoverTip>
            <RowMenuKebab
              label={`Actions for ${task.text}`}
              onOpen={(x, y) => menu.openAtPoint(x, y, task)}
            />
          </div>
        )}
      </div>

      <TaskLinkButton
        taskId={task.id}
        date={taskDate}
        existing={task.links}
        open={linkOpen}
        onOpenChange={setLinkOpen}
        showTrigger={false}
        onChanged={() => {
          void mutate("/api/tasks");
        }}
      />
      {taskMenu.dialogs}
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={taskMenu.groups}
        onClose={menu.close}
        label={`Task actions for ${task.text}`}
      />

      {showAbandon && (
        <div
          className="flex items-center gap-2 ml-9 mr-2 mb-1"
          style={{ animation: "fadeSlideIn 0.15s ease-out" }}
        >
          <input
            className="input"
            style={{ fontSize: "12px", flex: 1, minWidth: 0 }}
            placeholder="Reason (optional)…"
            value={abandonReason}
            onChange={(e) => setAbandonReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmAbandon();
              } else if (e.key === "Escape") {
                setShowAbandon(false);
                setAbandonReason("");
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "3px 8px", fontSize: 12 }}
            onClick={confirmAbandon}
          >
            Confirm
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "3px 8px", fontSize: 12 }}
            onClick={() => {
              setShowAbandon(false);
              setAbandonReason("");
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** Always-visible elapsed/running time for a task. The play/pause control lives
 *  with the other action icons (see .task-row-actions) so the timer is spaced
 *  consistently with the rest; this is just the readout. */
function TimerReadout({ task }: { task: Task }) {
  const running = !!task.timerStartedAt;
  const base = task.timeSpentMs ?? 0;
  const startedMs = running ? Date.parse(task.timerStartedAt!) : 0;

  // Subscribes to the shared 1 Hz ticker only while this task's timer runs, so
  // a list of stopped tasks costs nothing. Elapsed time is derived rather than
  // mirrored into state — the previous version kept a useState in sync with
  // Date.now() via its own setInterval, which is the same value computed twice.
  const now = useSecondTick(running);
  const elapsedMs = running ? base + Math.max(0, now - startedMs) : base;

  if (!running && elapsedMs <= 0) return null;

  return (
    <span
      className="task-timer-readout tabular-nums"
      data-running={running ? "true" : undefined}
      aria-label={running ? "Timer running" : "Time spent"}
    >
      {running && <span className="task-timer-dot" aria-hidden />}
      {formatDuration(elapsedMs)}
    </span>
  );
}
