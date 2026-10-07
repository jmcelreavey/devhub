"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { Bot, Copy, ExternalLink, FilePen, FileText, Link2, ListPlus, RefreshCw } from "lucide-react";
import type { JiraTicket } from "@/lib/jira/client";
import { copyTextAndToast } from "@/lib/pr-slack";
import { createOrOpenVaultNote } from "@/lib/create-vault-note";
import { openInBrowser } from "@/lib/desktop/bridge";
import { PersonChip } from "@/components/PersonChip";
import { JiraStatusPill } from "@/components/jira/JiraStatusPill";
import { JiraParentChip } from "@/components/jira/JiraKeyChip";
import { JiraTransitionModal } from "@/components/jira/JiraTransitionModal";
import { useVaultNoteExists } from "@/components/EntityNoteAction";
import {
  ContextMenu,
  RowMenuKebab,
  useContextMenu,
  type ContextMenuGroup,
} from "@/components/shell/ContextMenu";
import styles from "./JiraTicketRow.module.css";
import { useTagMenuGroup, withTagsGroup } from "@/lib/hooks/use-tag-menu";
import { useToast } from "@/lib/hooks/use-toast";
import { ImplementTaskDialog } from "@/components/tasks/ImplementTaskDialog";
import { PlanTaskDialog } from "@/components/tasks/PlanTaskDialog";
import type { Task } from "@/lib/tasks/types";
import { todayISO } from "@/lib/utils";

function ticketNotePath(key: string): string {
  return `tickets/${key}`;
}

function ticketNoteMarkdown(ticket: JiraTicket): string {
  return [`# ${ticket.key} ${ticket.summary}`, "", `**Jira:** [${ticket.key}](${ticket.url})`, ""].join("\n");
}

function formatUpdatedShort(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Same actions as the wide Jira ticket row — compact QueueRow hosts this too. */
export function useJiraTicketMenu(ticket: JiraTicket, onTransitioned?: () => void) {
  const toast = useToast();
  const router = useRouter();
  const [transitionOpen, setTransitionOpen] = useState(false);
  const menu = useContextMenu<JiraTicket>();
  const notePath = ticketNotePath(ticket.key);
  const noteExists = useVaultNoteExists(notePath);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskAction, setTaskAction] = useState<{
    task: Task;
    date: string;
    action: "plan" | "implement";
  } | null>(null);

  const createTask = async (action: "create" | "plan" | "implement") => {
    if (creatingTask) return;
    setCreatingTask(true);
    try {
      const date = todayISO();
      const res = await fetch(action === "plan" ? "/api/tasks/capture" : "/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `${ticket.key} ${ticket.summary}`,
          date,
          links: [{ kind: "jira", id: ticket.key, label: ticket.key, href: ticket.url }],
        }),
      });
      if (!res.ok) throw new Error("Task creation failed");
      const body = (await res.json()) as Task | { task: Task; date: string };
      const task = "task" in body ? body.task : body;
      const taskDate = "task" in body ? body.date : date;
      void mutate((key) => typeof key === "string" && key.startsWith("/api/tasks"));
      void mutate("/api/sidebar/counts");
      toast.success(`Task created from ${ticket.key}`, {
        action: { label: "View tasks", onClick: () => router.push("/tasks") },
      });
      if (action !== "create") setTaskAction({ task, date: taskDate, action });
    } catch {
      toast.error(`Couldn't create a task from ${ticket.key}.`);
    } finally {
      setCreatingTask(false);
    }
  };

  const openNote = async () => {
    try {
      const result = await createOrOpenVaultNote({
        path: notePath,
        markdown: ticketNoteMarkdown(ticket),
      });
      router.push(result.href);
    } catch {
      toast.error("Couldn't open ticket note.");
    }
  };

  const { group: tagsGroup, modal: tagsModal } = useTagMenuGroup({
    kind: "jira",
    id: ticket.key,
    label: ticket.summary,
    enabled: menu.target !== null,
  });

  const groups: ContextMenuGroup[] = withTagsGroup(
    [
      {
        id: "ticket",
        items: [
          {
            id: "copy-key",
            label: "Copy key",
            icon: <Copy size={12} />,
            onSelect: () => void copyTextAndToast(ticket.key, ticket.key, toast),
          },
          ...(ticket.parent ? [{
            id: "copy-parent-key",
            label: `Copy parent key (${ticket.parent.key})`,
            icon: <Copy size={12} aria-hidden />,
            onSelect: () => void copyTextAndToast(ticket.parent!.key, "parent key", toast),
          }] : []),
          {
            id: "open-jira",
            label: "Open in Jira",
            icon: <ExternalLink size={12} />,
            onSelect: () => void openInBrowser(ticket.url),
          },
          {
            id: "update-state",
            label: "Update ticket state",
            icon: <RefreshCw size={12} />,
            onSelect: () => setTransitionOpen(true),
          },
          {
            id: "note",
            label: noteExists ? "Open note" : "Create note",
            icon: <FileText size={12} />,
            onSelect: () => void openNote(),
          },
          {
            id: "copy-url",
            label: "Copy browse URL",
            icon: <Link2 size={12} />,
            onSelect: () => void copyTextAndToast(ticket.url, "browse URL", toast),
          },
        ],
      },
      {
        id: "task",
        label: "Task",
        items: [
          {
            id: "create-task",
            label: creatingTask ? "Creating task…" : "Create task",
            icon: <ListPlus size={12} aria-hidden />,
            disabled: creatingTask,
            onSelect: () => void createTask("create"),
          },
          {
            id: "plan-task",
            label: "Write plan with Agent…",
            description: "Create a task and open planning",
            icon: <FilePen size={12} aria-hidden />,
            disabled: creatingTask,
            onSelect: () => void createTask("plan"),
          },
          {
            id: "implement-task",
            label: "Implement with Agent…",
            description: "Create a task and open implementation",
            icon: <Bot size={12} aria-hidden />,
            disabled: creatingTask,
            onSelect: () => void createTask("implement"),
          },
        ],
      },
    ],
    tagsGroup,
  );

  const menuUi = (
    <>
      <ContextMenu
        open={menu.target !== null}
        position={menu.position}
        groups={groups}
        onClose={menu.close}
        label={`${ticket.key} actions`}
      />
      {tagsModal}
      {taskAction?.action === "plan" && (
        <PlanTaskDialog
          open
          task={taskAction.task}
          date={taskAction.date}
          onClose={() => setTaskAction(null)}
        />
      )}
      {taskAction?.action === "implement" && (
        <ImplementTaskDialog
          open
          task={taskAction.task}
          date={taskAction.date}
          onClose={() => setTaskAction(null)}
        />
      )}
      <JiraTransitionModal
        open={transitionOpen}
        jiraKey={ticket.key}
        title="Update Jira status"
        skipLabel="Cancel"
        suggest={ticket.status}
        onCancel={() => setTransitionOpen(false)}
        onConfirm={async (transitionId) => {
          setTransitionOpen(false);
          if (!transitionId) return;
          try {
            const res = await fetch(`/api/jira/ticket/${ticket.key}/transition`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transitionId }),
            });
            if (!res.ok) throw new Error("Transition failed");
            toast.success(`Updated ${ticket.key}`);
            void mutate("/api/jira/tickets");
            void mutate("/api/sidebar/counts");
            onTransitioned?.();
          } catch {
            toast.error(`Couldn't transition ${ticket.key}`);
          }
        }}
      />
    </>
  );

  return { menu, groups, noteExists, menuUi };
}

/** Dashboard rows share the full ticket list's layout and actions. */
export function JiraTicketQueueRow({
  ticket,
  onTransitioned,
}: {
  ticket: JiraTicket;
  onTransitioned?: () => void;
}) {
  return <JiraTicketRow ticket={ticket} showAssignee={false} onTransitioned={onTransitioned} />;
}

export function JiraTicketRow({
  ticket,
  density = "compact",
  showUpdated = true,
  showAssignee = true,
  showDetails = false,
  onTransitioned,
}: {
  ticket: JiraTicket;
  density?: "compact" | "comfortable";
  showUpdated?: boolean;
  showAssignee?: boolean;
  showDetails?: boolean;
  onTransitioned?: () => void;
}) {
  const { menu, noteExists, menuUi } = useJiraTicketMenu(ticket, onTransitioned);

  return (
    <div className={styles.row} data-density={density} role="listitem" {...menu.bindRow(ticket)}>
      <a
        href={ticket.url}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.title}
        title={ticket.summary}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {ticket.summary}
      </a>
      <div className={styles.actions}>
        {noteExists ? (
          <span className="row-note-glyph" title="Note exists" aria-hidden>
            <FileText size={12} />
          </span>
        ) : null}
        <RowMenuKebab
          label={`Actions for ${ticket.key}`}
          onOpen={(x, y) => menu.openAtPoint(x, y, ticket)}
        />
      </div>
      <div className={styles.meta}>
        <a
          href={ticket.url}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.key}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {ticket.key}
        </a>
        {ticket.parent ? <JiraParentChip parent={ticket.parent} /> : null}
        {showDetails ? (
          <span className={styles.details} title={`${ticket.project} (${ticket.projectKey}) · ${ticket.issuetype} · ${ticket.priority} priority`}>
            {ticket.issuetype} · {ticket.priority} priority
          </span>
        ) : null}
        {showAssignee && ticket.assignee ? (
          <PersonChip
            name={ticket.assignee.displayName}
            email={ticket.assignee.email}
            avatarUrl={ticket.assignee.avatarUrl}
            size={16}
            className={styles.assignee}
          />
        ) : null}
        {showUpdated && ticket.updatedAt ? (
          <time
            className={styles.updated}
            dateTime={ticket.updatedAt}
            title={`Updated ${new Date(ticket.updatedAt).toLocaleString()}`}
          >
            {formatUpdatedShort(ticket.updatedAt)}
          </time>
        ) : null}
        <span className={styles.status}>
          <JiraStatusPill ticketKey={ticket.key} status={ticket.status} onChanged={onTransitioned} />
        </span>
      </div>
      {menuUi}
    </div>
  );
}
