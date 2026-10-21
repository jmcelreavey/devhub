"use client";

import { useRouter } from "next/navigation";
import { ExternalLink, PanelRight } from "lucide-react";
import { buildPrRowMenuGroups, openPrRowNote } from "@/components/PrRowActions";
import { PrReviewNoteLink } from "@/components/PrReviewNoteLink";
import { ContextMenu, RowMenuKebab, useContextMenu, type ContextMenuGroup } from "@/components/shell/ContextMenu";
import { JiraStatusPill } from "@/components/jira/JiraStatusPill";
import { useJiraTicketMenu } from "@/components/jira/JiraTicketRow";
import { useTaskDetail } from "@/components/storyboard/TaskDetailProvider";
import { useTagMenuGroup } from "@/lib/hooks/use-tag-menu";
import { useToast } from "@/lib/hooks/use-toast";
import { wantsFullPage } from "@/lib/notes/open-in-panel";
import { prReviewNoteHref } from "@/lib/pr-review-notes";
import type { GithubPrRow } from "@/lib/github/prs";
import type { JiraTicket } from "@/lib/jira/client";
import styles from "./HomeWorkSummary.module.css";

/** Home's compact PR row, with the same right-click menu as the PRs page. */
export function HomePrRow({ pr, tab }: { pr: GithubPrRow; tab: "authored" | "owned" | "reviews" }) {
  const toast = useToast();
  const router = useRouter();
  const detail = useTaskDetail();
  const menu = useContextMenu<GithubPrRow>();
  const { group: tagsGroup, modal: tagsModal } = useTagMenuGroup({
    kind: "pr", id: `${pr.repo}#${pr.number}`, label: pr.title, prRepo: pr.repo, prNumber: pr.number, enabled: menu.target !== null,
  });
  // Owned PRs aren't in the authored/review lists, so "Skip until updated" would hide nothing here.
  const prGroups = buildPrRowMenuGroups({
    row: pr, kind: tab === "authored" ? "authored" : "reviews", canSkip: tab !== "owned", toast, tagsGroup,
    openNote: () => openPrRowNote(pr, (href) => router.push(href), toast),
  });
  const groups: ContextMenuGroup[] = detail
    ? [{ id: "details", items: [{ id: "details", label: "Open details", icon: <PanelRight size={12} aria-hidden />, onSelect: () => detail.openPr(pr) }] }, ...prGroups]
    : prGroups;
  return <li className="group" {...menu.bindRow(pr)}>
    {tab === "reviews" ? <>
      {/* Review requests open the AI review note in the Notes side panel (same path as the menu's Open note); modifier-click keeps the full note page. */}
      <a href={prReviewNoteHref(pr)} className={styles.compactTitle} title="Open review note" onClick={(event) => {
        if (wantsFullPage(event)) return;
        event.preventDefault();
        void openPrRowNote(pr, (href) => router.push(href), toast);
      }}><span>{pr.title}</span>{" "}<small>{pr.repo} #{pr.number}{pr.draft ? " · Draft" : ""}</small></a>
      <a href={pr.url} target="_blank" rel="noreferrer" className="row-note-glyph" title="Open on GitHub" aria-label={`Open ${pr.repo}#${pr.number} on GitHub`}><ExternalLink size={12} aria-hidden /></a>
    </> : <>
      <a href={pr.url} target="_blank" rel="noreferrer" className={styles.compactTitle}><span>{pr.title}</span>{" "}<small>{pr.repo} #{pr.number}{pr.draft ? " · Draft" : ""}</small></a>
      <PrReviewNoteLink row={pr} />
    </>}
    <RowMenuKebab label={`Actions for ${pr.repo}#${pr.number}`} onOpen={(x, y) => menu.openAtPoint(x, y, pr)} />
    {menu.target ? <ContextMenu open position={menu.position} groups={groups} onClose={menu.close} label={`${pr.repo}#${pr.number} actions`} /> : null}
    {tagsModal}
  </li>;
}

/** Home's compact ticket row, with the same right-click menu as the Tickets page. */
export function HomeTicketRow({ ticket, profile, onChanged }: { ticket: JiraTicket; profile?: string; onChanged: () => void }) {
  const { menu, menuUi } = useJiraTicketMenu(ticket, onChanged, true);
  return <li className="group" {...menu.bindRow(ticket)}>
    <a href={ticket.url} target="_blank" rel="noreferrer" className={styles.compactTitle}><span>{ticket.summary}</span>{" "}<small>{ticket.key}</small></a>
    <JiraStatusPill ticketKey={ticket.key} status={ticket.status} profile={profile} onChanged={onChanged} />
    <RowMenuKebab label={`Actions for ${ticket.key}`} onOpen={(x, y) => menu.openAtPoint(x, y, ticket)} />
    {menuUi}
  </li>;
}
