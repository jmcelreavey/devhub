"use client";

import { Ban, Check, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { JiraKeyChip } from "@/components/jira/JiraKeyChip";
import { TaskItem } from "@/components/tasks/TaskItem";
import { createOrOpenVaultNote } from "@/lib/create-vault-note";
import { useVaultNoteExists } from "@/components/EntityNoteAction";
import { useToast } from "@/lib/hooks/use-toast";
import type { EntityRef } from "@/lib/entity-note";
import type { JiraTicket } from "@/lib/jira/client";
import type { Task } from "@/lib/tasks/types";
import type { WorkHubTask, WorkHubTicket } from "@/lib/repos/work-hub";

export function asHubTask(task: WorkHubTask): Task {
  return {
    id: task.id,
    text: task.text,
    // Archive rows carry finishedAt; live hub tasks never do.
    done: Boolean(task.finishedAt) && !task.abandoned,
    completedAt: task.abandoned ? undefined : task.finishedAt,
    abandonedAt: task.abandoned ? task.finishedAt : undefined,
    abandonReason: task.abandonReason,
    jiraKey: task.jiraKey,
    createdAt: task.createdAt ?? "",
    links: task.links,
  };
}

/**
 * One finished task in the hub archive.
 *
 * Deliberately not a `TaskItem`: archive rows carry no actions, so the row is
 * the text, its ticket and when it landed — nothing to scan past.
 */
export function HubArchiveRow({ task }: { task: WorkHubTask }) {
  const when = (task.finishedAt ?? task.date ?? "").slice(0, 10);
  return (
    <div className="repo-hub-archive-row" data-abandoned={task.abandoned || undefined}>
      {task.abandoned ? (
        <Ban size={13} className="lib-card-icon" aria-label="Abandoned" />
      ) : (
        <Check size={13} className="lib-card-icon" aria-label="Completed" />
      )}
      {task.jiraKey ? <JiraKeyChip jiraKey={task.jiraKey} done /> : null}
      <span className="repo-hub-archive-text">{task.text}</span>
      {task.abandoned && task.abandonReason ? (
        <span className="repo-hub-row-meta truncate">{task.abandonReason}</span>
      ) : null}
      {when ? <span className="repo-hub-row-meta shrink-0">{when}</span> : null}
    </div>
  );
}

export function asHubJiraTicket(ticket: WorkHubTicket): JiraTicket {
  return {
    key: ticket.key,
    summary: ticket.summary,
    status: ticket.status,
    url: ticket.url,
    priority: "",
    issuetype: "",
    project: "",
    projectKey: ticket.key.split("-")[0] ?? "",
    updatedAt: "",
  };
}

export function repoNotePath(repoName: string): string {
  return `repos/${repoName}`;
}

export function repoNoteMarkdown(repoName: string, repoPath: string): string {
  return [`# ${repoName}`, "", `**Repo:** \`${repoPath}\``, ""].join("\n");
}

export function HubRepoNoteButton({
  repoName,
  repoPath,
}: {
  repoName: string;
  repoPath: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const path = repoNotePath(repoName);
  const exists = useVaultNoteExists(path);
  const label = exists ? "Open note" : "Create note";

  return (
    <button
      type="button"
      className="btn btn-ghost text-xs"
      aria-label={`${label} for ${repoName}`}
      onClick={async () => {
        try {
          const result = await createOrOpenVaultNote({
            path,
            markdown: repoNoteMarkdown(repoName, repoPath),
          });
          router.push(result.href);
        } catch {
          toast.error("Couldn't open repo note.");
        }
      }}
    >
      <FileText size={12} aria-hidden /> {label}
    </button>
  );
}

export function HubTaskRow({
  task,
  date,
  cwd,
  repoName,
  suppressLinks,
  onWorkMutate,
}: {
  task: WorkHubTask;
  date: string;
  cwd?: string;
  repoName?: string;
  /** Links the section header already shows once for the whole list. */
  suppressLinks?: readonly EntityRef[];
  onWorkMutate: () => void;
}) {
  const toast = useToast();
  const row = asHubTask(task);
  const taskDate = task.date || date;

  async function refresh() {
    void mutate("/api/tasks");
    onWorkMutate();
  }

  async function patch(body: Record<string, unknown>, fallback: string) {
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : fallback);
    }
  }

  return (
    <div className="repo-hub-cluster-task">
      <TaskItem
        task={row}
        date={taskDate}
        denseLinks
        cwd={cwd}
        repoName={repoName}
        suppressLinks={suppressLinks}
        onToggle={() => void patch({ id: task.id, done: true }, "Couldn't update task.")}
        onEdit={(text) => void patch({ id: task.id, text }, "Couldn't update task.")}
        onAbandon={(reason) =>
          void patch(
            { id: task.id, status: "abandoned", abandonReason: reason },
            "Couldn't abandon task.",
          )
        }
        onDelete={async () => {
          try {
            const res = await fetch("/api/tasks", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: task.id }),
            });
            if (!res.ok && res.status !== 404) throw new Error(await res.text());
            await refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't delete task.");
          }
        }}
      />
    </div>
  );
}
