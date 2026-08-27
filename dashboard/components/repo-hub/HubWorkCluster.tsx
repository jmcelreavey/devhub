"use client";

import { useState, type ReactNode } from "react";
import { GitPullRequest, NotebookPen, Play } from "lucide-react";
import { NoteListRow } from "@/components/notes/NoteListRow";
import { PrRow } from "@/components/PrRow";
import { useJiraTicketMenu } from "@/components/jira/JiraTicketRow";
import { RowMenuKebab } from "@/components/shell/ContextMenu";
import { SkillAgentDialog } from "@/components/tasks/SkillAgentDialog";
import { ImplementTaskDialog } from "@/components/tasks/ImplementTaskDialog";
import {
  asHubJiraTicket,
  asHubTask,
  HubTaskRow,
} from "@/components/repo-hub/HubWorkRows";
import { buildCreatePrPrompt } from "@/lib/tasks/create-pr-prompt";
import type { GithubPrRow } from "@/lib/github/prs";
import type { WorkCluster, WorkHubNote, WorkHubPr, WorkHubTask, WorkHubTicket } from "@/lib/repos/work-hub";

function HubJiraHeader({
  ticket,
  actions,
}: {
  ticket: WorkHubTicket;
  actions: ReactNode;
}) {
  const jira = asHubJiraTicket(ticket);
  const { menu, menuUi } = useJiraTicketMenu(jira);
  return (
    <div className="flex items-start justify-between gap-2" {...menu.bindRow(jira)}>
      <div className="min-w-0">
        <a
          href={ticket.url}
          target="_blank"
          rel="noopener noreferrer"
          className="repo-hub-row-title"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {ticket.key}
        </a>
        <p className="repo-hub-row-meta">
          {ticket.status} · {ticket.summary}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {actions}
        <RowMenuKebab
          label={`Actions for ${ticket.key}`}
          onOpen={(x, y) => menu.openAtPoint(x, y, jira)}
        />
      </div>
      {menuUi}
    </div>
  );
}

function asGithubPr(pr: WorkHubPr): GithubPrRow {
  return { number: pr.number, title: pr.title, url: pr.url, repo: pr.repo };
}

export function HubWorkCluster({
  cluster,
  date,
  repoName,
  repoPath,
  onWorkMutate,
}: {
  cluster: WorkCluster;
  date: string;
  repoName: string;
  repoPath: string;
  onWorkMutate: () => void;
}) {
  const [implement, setImplement] = useState<WorkHubTask | null>(null);
  const [createPr, setCreatePr] = useState(false);
  const title = cluster.jira?.key ?? cluster.tasks[0]?.text ?? "Work";
  const task = cluster.tasks[0];

  function renderNote(note: WorkHubNote) {
    const age =
      note.ts && note.ts > 0 ? new Date(note.ts).toISOString().slice(0, 10) : undefined;
    return (
      <NoteListRow key={note.slug} note={note} className="repo-hub-row">
        <NotebookPen size={14} className="lib-card-icon" />
        <span className="repo-hub-row-main">
          <span className="repo-hub-row-title">{note.title}</span>
          {age ? <span className="repo-hub-row-meta">{age}</span> : null}
        </span>
      </NoteListRow>
    );
  }

  const actions = (
    <>
      <button
        type="button"
        className="btn btn-ghost text-xs"
        onClick={() => setCreatePr(true)}
      >
        <GitPullRequest size={12} /> Create PR
      </button>
      {task ? (
        <button type="button" className="btn btn-ghost text-xs" onClick={() => setImplement(task)}>
          <Play size={12} /> Implement
        </button>
      ) : null}
    </>
  );

  return (
    <div className="repo-hub-cluster" data-in-progress={cluster.inProgress || undefined}>
      {cluster.jira ? (
        <HubJiraHeader ticket={cluster.jira} actions={actions} />
      ) : (
        <div className="flex items-start justify-between gap-2">
          <p className="repo-hub-row-title truncate">{title}</p>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">{actions}</div>
        </div>
      )}
      {cluster.tasks.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {cluster.tasks.map((item) => (
            <li key={item.id}>
              <HubTaskRow
                task={item}
                date={date}
                cwd={repoPath}
                repoName={repoName}
                onWorkMutate={onWorkMutate}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {cluster.notes.length > 0 ? (
        <div className="mt-2 divide-y divide-border">{cluster.notes.map(renderNote)}</div>
      ) : null}
      {cluster.prs.length > 0 ? (
        <div className="mt-2 divide-y divide-border">
          {cluster.prs.map((pr) => (
            <PrRow key={pr.url} row={asGithubPr(pr)} kind="authored" />
          ))}
        </div>
      ) : null}
      {implement ? (
        <ImplementTaskDialog
          open
          task={asHubTask(implement)}
          date={date}
          cwd={repoPath}
          repoName={repoName}
          onClose={() => setImplement(null)}
        />
      ) : null}
      {createPr ? (
        <SkillAgentDialog
          open
          title="Create PR with agent"
          description="Choose the CLI. The create-pr skill will ask before mutating git or GitHub."
          getPrompt={() =>
            buildCreatePrPrompt({
              repoName,
              jiraKey: cluster.jira?.key,
              taskId: task?.id,
              date: task ? date : undefined,
            })
          }
          cwd={repoPath}
          repoName={repoName}
          summary={`Create PR for ${repoName}`}
          reason={`Create PR via create-pr skill in ${repoName}`}
          onClose={() => setCreatePr(false)}
        />
      ) : null}
    </div>
  );
}
