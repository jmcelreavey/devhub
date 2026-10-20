"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Calendar, Cpu, FileText, FolderGit2, GitPullRequest, Globe, Link2, ListChecks, Ticket, Workflow } from "lucide-react";
import { defaultHrefForRef, taskNoteLinkToEntityRef } from "@shared/entity-note/index.ts";
import { TASK_NOTE_STATUS_LABEL, TASK_NOTE_STATUSES, isTaskNoteStatus, safeLinkHref, type TaskNoteLink } from "@shared/task-note/meta.ts";
import { jiraBrowseUrl } from "@/lib/utils";
import styles from "./task-note.module.css";
import { dedupePillLinks, pillText } from "./pill-links";

/** Notes that collected links over weeks would otherwise push everything below the fold. */
export const VISIBLE_LINKS = 8;

export const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(" ");

const STATUS_TONE: Record<string, string> = {
  todo: styles.muted,
  planning: styles.muted,
  "in-progress": styles.info,
  "needs-you": styles.warn,
  blocked: styles.bad,
  "draft-pr": styles.accent,
  "ready-for-review": styles.ok,
  done: styles.ok,
};

const LINK_ICON: Record<string, typeof Link2> = {
  pr: GitPullRequest,
  jira: Ticket,
  repo: FolderGit2,
  preview: Globe,
  task: ListChecks,
  note: FileText,
  diagram: Workflow,
  calendar: Calendar,
  meeting: Calendar,
};

function linkHref(link: TaskNoteLink): string | undefined {
  const explicit = safeLinkHref(link.href);
  if (explicit) return explicit;
  if (link.kind === "jira") return jiraBrowseUrl(link.id);
  const ref = taskNoteLinkToEntityRef(link);
  const resolved = safeLinkHref(ref ? defaultHrefForRef(ref) : undefined);
  // Nothing to open: fall back to the tasks view searched for it, so every pill goes somewhere.
  return resolved ?? `/work?tab=tasks&q=${encodeURIComponent(link.id || pillText(link))}`;
}

/** Where a tag pill goes: tasks filtered by that tag. */
export function tagHref(tag: string): string {
  return `/work?tab=tasks&tag=${encodeURIComponent(tag)}`;
}

/** Where a model pill goes: the Storyboard model-tier settings. */
export const MODEL_SETTINGS_HREF = "/storyboard?settings=model-tiers";

export function Pill({ href, className, title, children }: { href?: string; className?: string; title?: string; children: ReactNode }) {
  const classes = cx(styles.pill, className);
  if (!href) {
    return (
      <span className={classes} title={title}>
        {children}
      </span>
    );
  }
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={classes} title={title}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={classes} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function LinkPill({ link }: { link: TaskNoteLink }) {
  const Icon = LINK_ICON[link.kind] ?? Link2;
  return (
    <Pill href={linkHref(link)} title={link.label}>
      <Icon size={12} aria-hidden />
      <span>{pillText(link)}</span>
    </Pill>
  );
}

export interface TaskNotePillsProps {
  /** Known statuses render as a picker; an unrecognised one is kept as an extra option. */
  status?: string;
  onStatusChange?: (status: string) => void;
  /** Disables the status picker while a change is in flight. */
  statusPending?: boolean;
  openQuestions: number;
  /** Where the questions pill goes; the note links to its own section. */
  questionsHref?: string;
  tags: string[];
  links: TaskNoteLink[];
  models: string[];
  /** Pill row label for assistive tech. */
  label?: string;
  maxLinks?: number;
}

/**
 * The pill row under a task note's title: status, open questions, tags, links
 * and models. The note header and the Storyboard cards both render this, so a
 * card's pills are the note's pills.
 */
export function TaskNotePills({
  status,
  onStatusChange,
  statusPending,
  openQuestions,
  questionsHref = "#task-note-questions",
  tags,
  links: rawLinks,
  models,
  label = "Task details",
  maxLinks = VISIBLE_LINKS,
}: TaskNotePillsProps) {
  const [showAllLinks, setShowAllLinks] = useState(false);
  const links = dedupePillLinks(rawLinks);
  const visibleLinks = showAllLinks ? links : links.slice(0, maxLinks);
  return (
    <div className={styles.pills} role="group" aria-label={label}>
      {status ? (
        onStatusChange ? (
          <select
            className={cx(styles.pill, styles.pillSelect, STATUS_TONE[status] ?? styles.muted)}
            data-pill="status"
            value={status}
            aria-label="Task status"
            title="Change status"
            disabled={statusPending}
            onChange={(event) => onStatusChange(event.target.value)}
          >
            {!isTaskNoteStatus(status) ? <option value={status}>{status}</option> : null}
            {TASK_NOTE_STATUSES.map((value) => (
              <option key={value} value={value}>{TASK_NOTE_STATUS_LABEL[value]}</option>
            ))}
          </select>
        ) : (
          <span className={cx(styles.pill, STATUS_TONE[status] ?? styles.muted)} data-pill="status">
            {isTaskNoteStatus(status) ? TASK_NOTE_STATUS_LABEL[status] : status}
          </span>
        )
      ) : null}
      {openQuestions > 0 ? (
        <a className={cx(styles.pill, styles.warn)} href={questionsHref} data-pill="questions">
          {openQuestions} {openQuestions === 1 ? "question" : "questions"} for John
        </a>
      ) : null}
      {tags.map((tag) => (
        <Pill key={`tag:${tag}`} href={tagHref(tag)} title={`Tasks tagged #${tag}`}>
          <span>#{tag}</span>
        </Pill>
      ))}
      {visibleLinks.map((link, index) => (
        <LinkPill key={`${link.kind}:${link.id}:${index}`} link={link} />
      ))}
      {links.length > maxLinks ? (
        <button
          type="button"
          className={cx(styles.pill, styles.pillButton)}
          aria-expanded={showAllLinks}
          onClick={() => setShowAllLinks((value) => !value)}
        >
          {showAllLinks ? "Show fewer" : `+${links.length - maxLinks} more`}
        </button>
      ) : null}
      {models.map((model) => (
        <Pill key={`model:${model}`} href={MODEL_SETTINGS_HREF} className={styles.mono} title={`Model used: ${model}. Open model tier settings`}>
          <Cpu size={12} aria-hidden />
          <span>{model}</span>
        </Pill>
      ))}
    </div>
  );
}
