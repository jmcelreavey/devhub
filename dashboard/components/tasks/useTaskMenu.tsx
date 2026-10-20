"use client";

/**
 * The task right-click menu, shared by the Today's-tasks row (TaskItem) and the
 * Storyboard card, so the two can't drift: note, agent and auto actions, timer,
 * Jira, edit, abandon, delete and the tags group, with their dialogs.
 *
 * Callers pass the handlers they support; an item whose handler is missing is
 * left out (the board has no inline edit, for example). `extraGroups` adds a
 * surface's own actions (the board's Move to / Move up / Retry) after the shared ones.
 */
import { openNoteInPanel } from "@/lib/notes/open-in-panel";
import { useState, type ReactNode } from "react";
import { mutate } from "swr";
import { Ban, ExternalLink, FilePlus2, FileText, Pause, Pencil, Play, RotateCcw, Ticket, X } from "lucide-react";
import type { ContextMenuGroup, ContextMenuItem } from "@/components/shell/ContextMenu";
import { AddToJiraModal } from "@/components/tasks/AddToJiraModal";
import { groupTaskMenu } from "./taskMenuGroups";
import { useTaskAgentActions } from "@/components/tasks/useTaskAgentActions";
import { useVaultNoteExists } from "@/components/EntityNoteAction";
import { canonicalizeEntityRef, entityKey, type EntityRef } from "@/lib/entity-note";
import { createOrOpenVaultNote } from "@/lib/create-vault-note";
import { openInBrowser } from "@/lib/desktop/bridge";
import { useTagMenuGroup, withTagsGroup } from "@/lib/hooks/use-tag-menu";
import { useToast } from "@/lib/hooks/use-toast";
import { buildTaskNoteMarkdown, taskNotePath } from "@/lib/task-note";
import { rewriteTaskKey, stripLinkedJiraKeyFromText, stripTagTokens } from "@/lib/tasks/task-text";
import type { Task } from "@/lib/tasks/types";
import { jiraBrowseUrl } from "@/lib/utils";
import { useTaskCompletion } from "@/components/storyboard/useTaskCompletion";
import { useTaskActionPending } from "@/lib/storyboard/task-action";

export interface TaskMenuHandlers {
  /** Complete the task (the agent's "Complete task (PR merged)" uses it too). */
  onToggle: () => void;
  onComplete?: () => void;
  /** Abandon now, with an optional reason (agent items call it directly). */
  onAbandon: (reason?: string) => void;
  /** The menu's "Abandon" item: a surface that asks for a reason first opens its prompt here. Defaults to onAbandon. */
  onRequestAbandon?: () => void;
  onDelete?: () => void;
  /** Rewrites the task text; also used when a generated Jira ticket renames the task. */
  onEdit?: (text: string) => void;
  /** The "Edit" item: start inline editing. Left out when absent. */
  onStartEdit?: () => void;
  onTimer?: () => void;
  onAddNote?: () => void;
  onAddToJira?: () => void;
  onReactivate?: () => void;
  /** Replaces the default "open the note in Notes" (the board opens it in its overlay). */
  onOpenNote?: (notePath: string) => void;
}

export function useTaskMenu({
  task,
  date,
  cwd,
  repoName,
  inactive,
  menuOpen,
  handlers,
  extraGroups = [],
  notePath: knownNotePath,
  pending = false,
}: {
  task: Task;
  date: string;
  cwd?: string;
  repoName?: string;
  /** Abandoned, moved or read-only: only the safe items stay. */
  inactive: boolean;
  /** The menu is showing: the tags group loads only then. */
  menuOpen: boolean;
  handlers: TaskMenuHandlers;
  extraGroups?: ContextMenuGroup[];
  /** The task's note when the caller already found it (the board does): shown as Open note straight away. */
  notePath?: string;
  pending?: boolean;
}) {
  const toast = useToast();
  const [linkOpen, setLinkOpen] = useState(false);
  const [jiraDraftOpen, setJiraDraftOpen] = useState(false);
  const isAbandoned = !!task.abandonedAt;
  const complete = useTaskCompletion();
  const actionPending = useTaskActionPending(task.id);
  const agent = useTaskAgentActions({
    task,
    date,
    cwd,
    repoName,
    enabled: !inactive,
    onComplete: handlers.onComplete ?? (() => void complete({ taskId: task.id, date })),
    onAbandon: handlers.onAbandon,
  });

  const noteSource = {
    notePath: task.notePath,
    id: task.id,
    text: task.text,
    date,
    jiraKey: task.jiraKey,
    jiraUrl: task.jiraKey ? jiraBrowseUrl(task.jiraKey) : undefined,
    related: task.links,
  };
  const notePath = knownNotePath ?? taskNotePath(noteSource);
  const indexed = useVaultNoteExists(notePath);
  const noteExists = indexed || !!knownNotePath;

  const openTaskNote = async () => {
    if (knownNotePath && handlers.onOpenNote) {
      handlers.onOpenNote(knownNotePath);
      return;
    }
    try {
      const result = await createOrOpenVaultNote({ path: notePath, markdown: buildTaskNoteMarkdown(noteSource) });
      if (handlers.onOpenNote) handlers.onOpenNote(notePath);
      else openNoteInPanel(result.path);
    } catch {
      toast.error("Couldn't create task note.");
    }
  };

  const displayText = task.jiraKey ? stripLinkedJiraKeyFromText(task.text, task.jiraKey) : task.text;
  const { group: tagsGroup, modal: tagsModal, openModal: openLinks } = useTagMenuGroup({
    kind: "task",
    id: task.id,
    date,
    label: task.text,
    title: stripTagTokens(displayText),
    enabled: menuOpen || linkOpen,
    onRemoveRef: inactive
      ? undefined
      : async (ref) => {
          // The dialog lists canonical refs; the task may store an alias of
          // the same link, so match on the canonical key as well as the raw one.
          const target = entityKey(ref);
          const next = ((task.links ?? []) as EntityRef[]).filter(
            (stored) => entityKey(stored) !== target && entityKey(canonicalizeEntityRef(stored) ?? stored) !== target,
          );
          const res = await fetch("/api/tasks", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: task.id, date, links: next }),
          });
          if (!res.ok) {
            toast.error("Couldn't remove link");
            throw new Error(await res.text());
          }
          void mutate("/api/tasks");
          toast.success("Link removed");
        },
    onAddLink: inactive ? undefined : () => setLinkOpen(true),
  });

  const when = (condition: unknown, item: ContextMenuItem): ContextMenuItem[] => (condition ? [item] : []);
  const items: ContextMenuItem[] = [
    { id: "note", label: noteExists ? "Open note" : "Create note", icon: <FileText size={12} aria-hidden />, onSelect: () => void openTaskNote() },
    ...when(handlers.onAddNote && !task.handoff, { id: "add-note", label: "Add note", icon: <FilePlus2 size={12} aria-hidden />, onSelect: () => handlers.onAddNote?.() }),
    ...agent.menuItems,
    ...when(handlers.onTimer && !inactive, {
      id: "timer",
      label: task.timerStartedAt ? "Stop timer" : "Start timer",
      icon: task.timerStartedAt ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />,
      onSelect: () => handlers.onTimer?.(),
    }),
    ...when(!isAbandoned && task.jiraKey, {
      id: "open-jira",
      label: "Open in Jira",
      icon: <ExternalLink size={12} aria-hidden />,
      onSelect: () => void openInBrowser(jiraBrowseUrl(task.jiraKey!)),
    }),
    ...when(handlers.onStartEdit && !inactive, { id: "edit", label: "Edit", icon: <Pencil size={12} aria-hidden />, onSelect: () => handlers.onStartEdit?.() }),
    ...when(!inactive && !task.done && handlers.onEdit, {
      id: "generate-jira",
      label: "Generate Jira ticket…",
      icon: <Ticket size={12} aria-hidden />,
      onSelect: () => setJiraDraftOpen(true),
    }),
    ...when(!inactive && !task.done && handlers.onAddToJira, {
      id: "jira",
      label: "Add to Jira manually…",
      icon: <Ticket size={12} aria-hidden />,
      onSelect: () => handlers.onAddToJira?.(),
    }),
    ...when(isAbandoned && handlers.onReactivate, { id: "reactivate", label: "Reactivate", icon: <RotateCcw size={12} aria-hidden />, onSelect: () => handlers.onReactivate?.() }),
    ...when(!inactive && !task.done, {
      id: "abandon",
      label: "Abandon",
      danger: true,
      icon: <Ban size={12} aria-hidden />,
      onSelect: () => (handlers.onRequestAbandon ? handlers.onRequestAbandon() : handlers.onAbandon()),
    }),
    ...when(handlers.onDelete, { id: "delete", label: "Delete", icon: <X size={12} aria-hidden />, onSelect: () => handlers.onDelete?.(), danger: true }),
  ];
  const groups: ContextMenuGroup[] = groupTaskMenu(withTagsGroup([{ id: "task", items }, ...extraGroups], tagsGroup)).map((group) => ({
    ...group,
    items: group.items.map((entry) => ({ ...entry, disabled: entry.disabled || pending || actionPending })),
  }));

  const dialogs: ReactNode = (
    <>
      {agent.dialogs}
      {jiraDraftOpen && handlers.onEdit ? (
        <AddToJiraModal
          open
          task={task}
          date={date}
          generateOnOpen
          onClose={() => setJiraDraftOpen(false)}
          onCreated={(newKey) => handlers.onEdit?.(rewriteTaskKey(task.text, task.jiraKey, newKey))}
        />
      ) : null}
      {tagsModal}
    </>
  );

  return { groups, agent, dialogs, noteExists, openTaskNote, openLinks, linkOpen, setLinkOpen };
}
