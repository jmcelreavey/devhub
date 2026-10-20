"use client";

import { Fragment } from "react";
import { useSWRConfig } from "swr";
import { JiraKeyChip } from "@/components/jira/JiraKeyChip";
import { JiraStatusPill } from "@/components/jira/JiraStatusPill";
import { useJiraTicketMenu } from "@/components/jira/JiraTicketRow";
import { RepoContextLink } from "@/components/repos/RepoContextLink";
import { useJiraTicketStatus } from "@/lib/hooks/use-jira-ticket-status";
import type { JiraTicket } from "@/lib/jira/client";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { jiraBrowseUrl } from "@/lib/utils";
import styles from "./HomeWorkSummary.module.css";

function HomeTaskJiraKey({ jiraKey, card, status, profile }: {
  jiraKey: string; card: BoardCard; status?: string; profile?: string;
}) {
  const { mutate } = useSWRConfig();
  const ticket: JiraTicket = {
    key: jiraKey, summary: card.title, url: jiraBrowseUrl(jiraKey), status: status ?? "",
    priority: "", issuetype: "", project: "", projectKey: jiraKey.split("-")[0], updatedAt: "",
  };
  const { menu, menuUi } = useJiraTicketMenu(ticket, () => void mutate(`/api/jira/ticket/${encodeURIComponent(jiraKey)}`), true, profile);
  return <JiraKeyChip quiet jiraKey={jiraKey} href={ticket.url} menu={{
    onOpen: (x, y, host) => menu.openAtPoint(x, y, ticket, host),
    content: menuUi,
  }} />;
}

/** Repo and ticket controls can move with a task row without carrying its layout or menu. */
export function HomeTaskContext({ card, profile }: { card: BoardCard; profile?: string }) {
  const primaryKey = card.jira?.[0];
  const open = !(card.taskDone || card.task?.done || card.task?.abandonedAt || card.task?.endDate || card.task?.movedAt);
  const { status, refresh } = useJiraTicketStatus(open ? primaryKey : undefined);
  if (!card.repo && !card.jira?.length) return null;
  return <span className={styles.taskContext} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    {card.repo ? <RepoContextLink name={card.repo} /> : null}
    {(card.jira ?? []).map((key, index) => <Fragment key={key}>
      {card.repo || index > 0 ? <span aria-hidden> · </span> : null}
      <HomeTaskJiraKey jiraKey={key} card={card} status={key === primaryKey ? status : undefined} profile={profile} />
    </Fragment>)}
    {open && primaryKey && status ? <JiraStatusPill ticketKey={primaryKey} status={status} profile={profile} onChanged={() => void refresh()} /> : null}
  </span>;
}
