"use client";

import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";
import Link from "next/link";
import { HomeTaskContext } from "@/components/home/HomeTaskContext";
import { useTaskDetail } from "@/components/storyboard/TaskDetailProvider";
import { useTaskNoteComposer } from "@/components/tasks/AddNoteComposer";
import { hasLiveWork } from "@/lib/storyboard/next-action";
import { useState, type ReactNode } from "react";
import { RowMenuKebab, useContextMenu, type ContextMenuPosition } from "@/components/shell/ContextMenu";
import type { CardMenuActions } from "@/app/storyboard/CardMenu";
import type { TaskNoteStatus } from "@shared/task-note/meta.ts";
import { ScreenshotIndicator } from "./TaskContext";
import { WorkCardMenu } from "./WorkCardMenu";
import { TeamTaskButtons } from "./TeamTaskActions";
import { WorkCardPrMenu } from "./WorkCardPrMenu";
import { costLabel } from "@/lib/storyboard/work-insights";
import { WorkActionButton } from "./WorkActionButton";
import type { NextAction, WorkPresentation } from "@/lib/storyboard/next-action";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { storyboardHrefForTask } from "@/lib/storyboard/orchestration";
import type { GithubPrRow } from "@/lib/github/prs";
import styles from "./WorkCard.module.css";

type WorkCardIdentity = { card: BoardCard; pr?: never } | { pr: GithubPrRow; card?: never };

export function WorkCard({ card, pr, presentation, pending = false, onAction, onOpen, detailHref, onDone, menuConfig, compact = false, taskControls, renderTaskMenu, home = false, profile, titleEditor, pills }: WorkCardIdentity & {
  /** Status chips (stage, Auto switch, agent run) shown in place of the status sentence, which moves to their tooltip. */
  pills?: ReactNode;
  titleEditor?: ReactNode;
  taskControls?: ReactNode;
  renderTaskMenu?: (props: { open: boolean; position: ContextMenuPosition | null; onClose: () => void }) => ReactNode;
  compact?: boolean;
  home?: boolean;
  profile?: string;
  menuConfig?: { actions: CardMenuActions; columns: readonly TaskNoteStatus[]; place: { index: number; count: number } };
  presentation: WorkPresentation;
  pending?: boolean;
  onAction: (action: NextAction) => void;
  onOpen?: () => void;
  detailHref?: string;
  onDone?: () => void;
}) {
  const detail = useTaskDetail();
  const note = useTaskNoteComposer({ taskId: card?.taskId ?? "", title: card?.title ?? "", profile, running: card ? hasLiveWork(card) : false });
  const blocked = isTaskOwnershipBlocked(card?.task);
  const menu = useContextMenu<string>();
  const [opened, setOpened] = useState(false);
  const title = pr?.title ?? card!.title;
  const context = pr ? `${pr.repo} · PR #${pr.number}` : [card!.repo, ...(card!.jira ?? [])].filter(Boolean).join(" · ");
  const href = detailHref ?? (pr ? pr.url : card!.noteHref ?? storyboardHrefForTask(card!.taskId));
  return (
    <article className={`${styles.card}${compact ? ` ${styles.compact}` : ""}${home ? ` ${styles.home}` : ""}`} aria-label={title} data-needs-action={home && presentation.needsYou || undefined} data-failed={["retry", "auto-retry"].includes(presentation.action?.kind ?? "") || undefined} tabIndex={0} onContextMenu={(event) => {
      event.preventDefault(); setOpened(true); menu.openAtPoint(event.clientX, event.clientY, title, event.currentTarget);
    }} onKeyDown={(event) => {
      if (event.target !== event.currentTarget || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
      event.preventDefault(); setOpened(true); const rect = event.currentTarget.getBoundingClientRect(); menu.openAtPoint(rect.left + 12, rect.top + 28, title, event.currentTarget);
    }}>
      <div className={styles.copy}>
        <div className={styles.heading}>{titleEditor ?? <Link className={styles.title} title={title} href={href} aria-haspopup={onOpen ? "dialog" : undefined} onClick={onOpen ? (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onOpen();
        } : undefined}>{title}</Link>}
        {home && card ? <HomeTaskContext card={card} profile={profile} /> : context ? <span className={styles.context}>{context}</span> : null}</div>
        {card?.summary.join(" ").trim() ? <p className={styles.summary}>{card.summary.join(" ")}</p> : null}
        {card ? <ScreenshotIndicator card={card} viewer /> : null}
        {pills ? <div className={styles.pills} title={presentation.status}>{pills}<span className="sr-only">{presentation.status}</span></div> : <p className={`${styles.status}${card?.finishedFeedback ? ` ${styles.feedback}` : ""}`} title={presentation.status}>{card?.task?.handoff ? (card.task.handoff.status === "pending" ? "Handing to @" : "Handed to @") + card.task.handoff.toName + (card.task.handoff.status === "pending" ? "…" : "") : presentation.status}</p> }
        {card && costLabel(card.costUsd) ? <span className="text-xs text-text-muted" title="Reported task cost">{costLabel(card.costUsd)}</span> : null}
      </div>
      <div className={styles.actions}>
      {card && !blocked ? taskControls : null}
      {onDone && !blocked ? <button type="button" className="btn btn-ghost text-xs" disabled={pending} onClick={onDone} aria-label={`Mark ${title} done`}>Done</button> : null}
      {presentation.action && !blocked ? <WorkActionButton quiet={compact && !["retry", "auto-retry"].includes(presentation.action.kind)} action={presentation.action} pending={pending} onAction={onAction} onOpen={onOpen} detailHref={detailHref} className={!compact && presentation.action.kind === "start-auto" ? `${styles.action} ${styles.quietStart}` : styles.action} /> : null}
      {!blocked && presentation.action?.kind === "reopen-feedback" ? <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => onAction({ kind: "reopen", label: "Reopen" })}>Reopen</button> : null}
      {card && !blocked && presentation.action?.kind === "approve-plan" ? <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => detail?.openTask(card.taskId, "revise-plan")}>Revise</button> : null}
      {opened && card ? renderTaskMenu && !blocked ? renderTaskMenu({ open: menu.target === title, position: menu.position, onClose: menu.close }) : <WorkCardMenu config={menuConfig} card={card} open={menu.target === title} position={menu.position} onClose={menu.close} /> : null}
      {card ? <TeamTaskButtons card={card} profile={detail?.profileId} /> : null}
      {card && !blocked && !home ? <span className={styles.noteTrigger}>{note.trigger}</span> : null}
      {home && card ? <RowMenuKebab triggerRef={note.triggerRef} label={`Actions for ${title}`} onOpen={(x, y) => { setOpened(true); menu.openAtPoint(x, y, title); }} /> : null}
      </div>
      {opened && pr ? <WorkCardPrMenu pr={pr} open={menu.target === title} position={menu.position} onClose={menu.close} onOpen={onOpen} /> : null}
      {card && !blocked ? note.composer : null}
    </article>
  );
}
