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
import { useRouter } from "next/navigation";
import { type Task } from "@/lib/tasks/types";
import { TaskTextContent } from "@/components/tasks/TaskText";
import { stripLinkedJiraKeyFromText, stripTagToken } from "@/lib/tasks/task-text";
import { extractTags } from "@/lib/entity-note";
import { useTagMenuGroup, withTagsGroup } from "@/lib/hooks/use-tag-menu";
import { statusTone } from "@/components/jira/JiraWidget";
import {
  X,
  ExternalLink,
  Circle,
  CheckCircle2,
  Pencil,
  Ban,
  RotateCcw,
  ArrowRight,
  Play,
  Pause,
  GripVertical,
  Ticket,
  FileText,
  Hash,
} from "lucide-react";
import { JiraKeyChip } from "@/components/jira/JiraKeyChip";
import { JiraStatusPill } from "@/components/jira/JiraStatusPill";
import { HoverTip } from "@/components/ui/HoverTip";
import { SeverityPill } from "@/components/ui/Severity";
import { useSecondTick } from "@/lib/tickers";
import { formatDuration, jiraBrowseUrl, todayISO } from "@/lib/utils";
import { openInBrowser } from "@/lib/desktop/bridge";
import { buildTaskNoteMarkdown, taskNotePath } from "@/lib/task-note";
import { createOrOpenVaultNote } from "@/lib/create-vault-note";
import { useVaultNoteExists } from "@/components/EntityNoteAction";
import { EntityLinkChips } from "@/components/EntityLinkChips";
import { TaskLinkButton } from "@/components/TaskLinkButton";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
  type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import { mutate } from "swr";
import type { EntityRef } from "@/lib/entity-note";
import { useToast } from "@/lib/hooks/use-toast";
import { useTaskAgentActions } from "@/components/tasks/useTaskAgentActions";

interface JiraStatus {
  name: string;
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
  denseLinks = false,
  cwd,
  repoName,
  suppressLinks,
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
  /** Narrow surfaces (tasks sidebar) show fewer hop chips. */
  denseLinks?: boolean;
  /** Hub checkout — Implement launches here instead of guessing from the plan. */
  cwd?: string;
  repoName?: string;
  /** Links the surrounding list already shows once in its header. */
  suppressLinks?: readonly EntityRef[];
}) {
  const toast = useToast();
  const router = useRouter();
  const menu = useContextMenu<Task>();
  const taskDate = date ?? todayISO();
  const [editing, setEditing] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [editText, setEditText] = useState(task.text);
  const [showAbandon, setShowAbandon] = useState(false);
  const [abandonReason, setAbandonReason] = useState("");
  // True only in the moment the user just checked the box, so the confetti
  // burst fires on completion — not when an already-done list renders.
  const [justCompleted, setJustCompleted] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  const isAbandoned = !!task.abandonedAt;
  const isMoved = !!task.movedAt;
  const isInactive = isAbandoned || isMoved || readOnly;
  const agent = useTaskAgentActions({
    task,
    date: taskDate,
    cwd,
    repoName,
    enabled: !isInactive,
    onComplete: onToggle,
    onAbandon,
  });

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

  const noteSource = {
    id: task.id,
    text: task.text,
    date: taskDate,
    jiraKey: task.jiraKey,
    jiraUrl: task.jiraKey ? jiraBrowseUrl(task.jiraKey) : undefined,
    related: task.links,
  };

  const displayText = task.jiraKey
    ? stripLinkedJiraKeyFromText(task.text, task.jiraKey)
    : task.text;

  const hostTags = extractTags(task.text);
  const { group: tagsGroup, modal: tagsModal, openModal: openTags } = useTagMenuGroup({
    kind: "task",
    id: task.id,
    date: taskDate,
    label: task.text,
    extraTags: hostTags,
    enabled: menu.target !== null || linkOpen,
    onAddTag: isInactive
      ? undefined
      : (tag) => {
          if (hostTags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
          onEdit(`${task.text} #${tag}`);
        },
    onRemoveRef: isInactive
      ? undefined
      : async (ref) => {
          if (ref.kind === "tag") {
            const next = stripTagToken(task.text, ref.id);
            if (next && next !== task.text) onEdit(next);
            return;
          }
          const next = (task.links ?? []).filter((r) => !(r.kind === ref.kind && r.id === ref.id));
          const res = await fetch("/api/tasks", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: task.id, date: taskDate, links: next }),
          });
          if (!res.ok) {
            toast.error("Couldn't remove link");
            throw new Error(await res.text());
          }
          void mutate("/api/tasks");
        },
    onAddLink: isInactive ? undefined : () => setLinkOpen(true),
  });

  const textStyle: React.CSSProperties = {
    color: task.done || isInactive ? "var(--text-subtle)" : "var(--text)",
    textDecoration: task.done ? "line-through" : "none",
    opacity: task.done ? 0.6 : isInactive ? 0.45 : 1,
  };

  // The trailing meta cluster (Jira status, due date, timer readout) renders
  // in the fixed action rail so it lines up with the note/tags icons across
  // rows; only render it when it has content so plain tasks stay compact.
  const showJiraStatus = !!jiraStatus && !task.done && !isAbandoned;
  const showTimerReadout = !isInactive && (!!task.timerStartedAt || (task.timeSpentMs ?? 0) > 0);

  const dueDateLabel = task.due ? new Date(task.due).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  const showDueDate = !!dueDateLabel && !task.done && !isAbandoned;

  const notePath = taskNotePath(noteSource);
  const noteExists = useVaultNoteExists(notePath);

  const openTaskNote = async () => {
    try {
      const result = await createOrOpenVaultNote({
        path: notePath,
        markdown: buildTaskNoteMarkdown(noteSource),
      });
      router.push(result.href);
    } catch {
      toast.error("Couldn't create task note.");
    }
  };

  const menuGroups: ContextMenuGroup[] = withTagsGroup(
    [
    {
      id: "task",
      items: [
        {
          id: "note",
          label: noteExists ? "Open note" : "Create note",
          icon: <FileText size={12} aria-hidden />,
          onSelect: () => void openTaskNote(),
        },
        ...agent.menuItems,
        ...(onTimer && !isInactive
          ? [
              {
                id: "timer",
                label: task.timerStartedAt ? "Stop timer" : "Start timer",
                icon: task.timerStartedAt ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />,
                onSelect: onTimer,
              },
            ]
          : []),
        ...(!isAbandoned && task.jiraKey
          ? [
              {
                id: "open-jira",
                label: "Open in Jira",
                icon: <ExternalLink size={12} aria-hidden />,
                onSelect: () => void openInBrowser(jiraBrowseUrl(task.jiraKey!)),
              },
            ]
          : []),
        ...(!isInactive
          ? [
              {
                id: "edit",
                label: "Edit",
                icon: <Pencil size={12} aria-hidden />,
                onSelect: () => {
                  setEditing(true);
                  setEditText(task.text);
                },
              },
            ]
          : []),
        ...(!isInactive && !task.done && onAddToJira
          ? [
              {
                id: "jira",
                label: task.jiraKey ? "Update Jira ticket" : "Add to Jira",
                icon: <Ticket size={12} aria-hidden />,
                onSelect: onAddToJira,
              },
            ]
          : []),
        ...(isAbandoned && onReactivate
          ? [
              {
                id: "reactivate",
                label: "Reactivate",
                icon: <RotateCcw size={12} aria-hidden />,
                onSelect: onReactivate,
              },
            ]
          : []),
        ...(!isInactive && !task.done
          ? [
              {
                id: "abandon",
                label: "Abandon",
                icon: <Ban size={12} aria-hidden />,
                onSelect: () => setShowAbandon(true),
              },
            ]
          : []),
        {
          id: "delete",
          label: "Delete",
          icon: <X size={12} aria-hidden />,
          onSelect: onDelete,
          danger: true,
        },
      ],
    },
    ],
    tagsGroup,
  );

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
          {task.jiraKey && !isAbandoned && <JiraKeyChip jiraKey={task.jiraKey} done={task.done} />}

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
              {task.jiraKey && !isAbandoned
                ? <TaskTextContent text={displayText} />
                : <TaskTextContent text={task.text} />}
            </span>
          )}

          {isAbandoned && task.abandonReason && (
            <span
              className="text-xs min-w-0 basis-full break-words leading-snug"
              style={{ color: "var(--text-subtle)", opacity: 0.6 }}
            >
              - {task.abandonReason}
            </span>
          )}

        </div>

        {!editing && !showAbandon && (
          <div className="task-row-actions">
            {/* Trailing meta (Jira status, due date, timer) leads the rail so the
                note/tags icons keep the same column across rows. */}
            {(showJiraStatus || showDueDate || showTimerReadout || agent.chip) && (
              <div className="task-row-meta">
                {agent.chip}
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
                {showDueDate && (
                  <span className="text-xs shrink-0 font-mono text-text-subtle">
                    due {dueDateLabel}
                  </span>
                )}
                {!isInactive && <TimerReadout task={task} />}
              </div>
            )}
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
            <HoverTip label="Tags">
              <button
                type="button"
                className="row-menu-kebab shrink-0"
                aria-label="Tags"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openTags();
                }}
              >
                <Hash size={14} aria-hidden />
              </button>
            </HoverTip>
            <RowMenuKebab
              label={`Actions for ${task.text}`}
              onOpen={(x, y) => menu.openAtPoint(x, y, task)}
            />
          </div>
        )}
      </div>

      {!editing && !showAbandon && (
        <div className="task-row-links ml-9 mr-2">
          <EntityLinkChips
            kind="task"
            id={task.id}
            date={taskDate}
            label={task.text}
            seed={task.links as EntityRef[] | undefined}
            suppressJiraKey={task.jiraKey}
            hostTags={hostTags}
            hideCompanionNotes={noteExists}
            suppressRepo={repoName}
            suppressRefs={suppressLinks}
            maxVisible={denseLinks ? 2 : 4}
            onHostContextMenu={(e) => menu.openAt(e, task)}
            onRemoveSeed={
              readOnly || isInactive
                ? undefined
                : async (ref) => {
                    const next = (task.links ?? []).filter(
                      (r) => !(r.kind === ref.kind && r.id === ref.id),
                    );
                    const res = await fetch("/api/tasks", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: task.id, date: taskDate, links: next }),
                    });
                    if (!res.ok) {
                      toast.error("Couldn't remove link");
                      throw new Error(await res.text());
                    }
                    void mutate("/api/tasks");
                    toast.success("Link removed");
                  }
            }
          />
        </div>
      )}

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
      {agent.dialogs}
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={menuGroups}
        onClose={menu.close}
        label={`Task actions for ${task.text}`}
      />
      {tagsModal}

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
