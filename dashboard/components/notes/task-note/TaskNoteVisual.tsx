"use client";

import { type ReactNode } from "react";
import { Check, Circle, Eye, FileCode } from "lucide-react";
import { extractTags } from "@shared/entity-note/index.ts";
import type {
  BugItem,
  InlineNode,
  BugStatus,
  DecisionItem,
  TaskNoteOp,
  TaskNoteSectionKey,
  TaskNoteView,
} from "@shared/task-note/sections.ts";
import { useLive } from "@/lib/hooks/use-fetch";
import { renderInline } from "./inline";
import { TaskNoteMedia } from "./TaskNoteMedia";
import styles from "./task-note.module.css";
import { Pill, TaskNotePills, cx, tagHref } from "./TaskNotePills";
import { parseTagLine } from "@/lib/notes/tag-line";
import { TaskNoteQuestions, type TaskNoteOperation } from "./TaskNoteQuestions";

interface LiveTaskDay {
  tasks: Array<{ id: string; done: boolean }>;
}

export interface TaskNoteVisualProps {
  view: TaskNoteView;
  /** Source mode shows the whole note in the editor instead of the rendered sections. */
  sourceMode: boolean;
  onToggleSource: () => void;
  /** Apply a section operation (answer a question, change a bug status). */
  onOp: TaskNoteOperation;
  hideQuestions?: boolean;
  /** The editor for free-form content. */
  children?: ReactNode;
}

/** A `Tags: #a #b` line as pills, matching the tag pills at the top. The stored text is unchanged. */
function TagLine({ tags }: { tags: string[] }) {
  return (
    <span className={styles.tagLine} data-tag-line>
      <span className={styles.tagLabel}>Tags:</span>
      {tags.map((tag) => (
        <Pill key={tag} href={tagHref(tag)} title={`Tasks tagged #${tag}`}>
          <span>#{tag}</span>
        </Pill>
      ))}
    </span>
  );
}

/** Inline content of one prose line; a line that is only `Tags: #a #b` becomes pills. */
function renderProseLine(nodes: InlineNode[]): ReactNode {
  if (nodes.every((node) => node.type === "text")) {
    const line = parseTagLine(nodes.map((node) => node.text ?? "").join(""));
    if (line) return <TagLine tags={line.tags.map((token) => token.tag)} />;
  }
  return renderInline(nodes);
}

function Label({ children, count, id }: { children: ReactNode; count?: number; id?: string }) {
  return (
    <h2 className={styles.label} id={id}>
      {children}
      {count !== undefined ? <small>{count}</small> : null}
    </h2>
  );
}

const BUG_TONE: Record<BugStatus, string> = { open: styles.warn, fixed: styles.ok, wontfix: styles.muted };
const SEVERITY_TONE: Record<string, string> = { blocker: styles.bad, high: styles.bad, medium: styles.warn, low: styles.muted };

function BugCard({ bug, onOp }: { bug: BugItem; onOp: (op: TaskNoteOp) => void }) {
  return (
    <div
      className={cx(styles.item, bug.status === "open" ? styles.bug : bug.status === "fixed" ? styles.bugFixed : styles.bugClosed)}
      data-bug={bug.status}
    >
      <span className={styles.itemRow}>
        <select
          className={cx(styles.chipSelect, BUG_TONE[bug.status])}
          value={bug.status}
          aria-label={`Status of ${bug.title}`}
          onChange={(event) => onOp({ op: "set_bug_status", id: bug.id, status: event.target.value as BugStatus })}
        >
          <option value="open">open</option>
          <option value="fixed">fixed</option>
          <option value="wontfix">won&apos;t fix</option>
        </select>
        {bug.severity ? <span className={cx(styles.pill, SEVERITY_TONE[bug.severity])}>{bug.severity}</span> : null}
        <span>{bug.title}</span>
        {bug.details ? <span className={styles.detail}>{bug.details}</span> : null}
      </span>
    </div>
  );
}

function DecisionCard({ decision }: { decision: DecisionItem }) {
  return (
    <div className={cx(styles.item, styles.decision)} data-decision>
      <strong>{decision.title}</strong> {renderInline(decision.body)}
    </div>
  );
}

function StrayText({ lines }: { lines?: string[] }) {
  if (!lines?.length) return null;
  return (
    <>
      {lines.map((line, index) => {
        const tagLine = parseTagLine(line);
        return (
          <p key={index} className={styles.stray}>
            {tagLine ? <TagLine tags={tagLine.tags.map((token) => token.tag)} /> : line}
          </p>
        );
      })}
    </>
  );
}

function formatDay(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The visual face of a task note: title, a row of pills, then the standard
 * sections. Sections with nothing in them do not render. The note's free-form
 * content (the editor) goes below as `children`.
 */
export function TaskNoteVisual({ view, sourceMode, onToggleSource, onOp, hideQuestions = false, children }: TaskNoteVisualProps) {
  // The live task record wins for "done": completing the task anywhere updates the header.
  const taskId = view.taskRef?.taskId;
  const { data: liveTask } = useLive<LiveTaskDay>(taskId ? `/api/tasks?taskId=${encodeURIComponent(taskId)}` : null, {
    refreshInterval: 30_000,
  });
  const task = liveTask?.tasks[0];
  
  if (sourceMode) {
    return (
      <div data-task-note="source" className={styles.root}>
        <div className={styles.top} style={{ marginBottom: 12 }}>
          <p className={styles.sub} style={{ margin: 0 }}>
            Editing the whole note, including the metadata block and section lists.
          </p>
          <button type="button" className={styles.sourceToggle} onClick={onToggleSource}>
            <Eye size={13} aria-hidden /> Back to view
          </button>
        </div>
        <div className={styles.freeformFull}>{children}</div>
      </div>
    );
  }

  const meta = view.meta ?? {};
  const openQuestions = view.questions.filter((q) => !q.resolved);
  // The agent-set status wins; a done task only fills in when the note has none.
  const status = meta.status ?? (task?.done ? "done" : undefined);
  const tags = [...new Set([...(meta.tags ?? []), ...extractTags(view.title)])];
  const day = formatDay(meta.date);

  return (
    <div data-task-note="visual" className={styles.root}>
      <article className={styles.card} aria-label="Task note">
        <div className={styles.top}>
          <h1 className={styles.title}>{view.title || "Untitled task"}</h1>
          <button type="button" className={styles.sourceToggle} onClick={onToggleSource} title="Edit the whole note as text">
            <FileCode size={13} aria-hidden /> Edit source
          </button>
        </div>
        {day ? <p className={styles.sub}>Created {day}</p> : null}

        <TaskNotePills
          status={status}
          onStatusChange={status ? (value) => onOp({ op: "set_status", status: value }) : undefined}
          openQuestions={openQuestions.length}
          tags={tags}
          links={meta.links ?? []}
          models={meta.models ?? []}
        />

        {view.meta === null ? (
          <p className={styles.repair}>
            The metadata block is not valid JSON, so status, tags and links are hidden. Use Edit source to fix it; agents will not overwrite it.
          </p>
        ) : null}

        {view.summary.length > 0 || view.other.summary?.length ? (
          <section aria-label="Summary">
            <Label>Summary</Label>
            {view.summary.map((nodes, index) => (
              <p key={index} className={styles.prose}>
                {renderProseLine(nodes)}
              </p>
            ))}
            <StrayText lines={view.other.summary} />
          </section>
        ) : null}

        {view.statusText.length > 0 || view.other.status?.length ? (
          <section aria-label="Status">
            <Label>Status</Label>
            {view.statusText.map((nodes, index) => (
              <p key={index} className={styles.statusLine}>
                {index === 0 ? <span className={cx(styles.pill, styles.accent)}>Next</span> : null}
                <span>{renderInline(nodes)}</span>
              </p>
            ))}
            <StrayText lines={view.other.status} />
          </section>
        ) : null}

        {!hideQuestions && view.questions.length > 0 ? (
          <section aria-label="Questions for John">
            <Label id="task-note-questions" count={openQuestions.length > 0 ? openQuestions.length : undefined}>
              Questions for John
            </Label>
            <TaskNoteQuestions questions={view.questions} onOp={onOp} />
            <StrayText lines={view.other.questions} />
          </section>
        ) : null}

        {view.userNotes?.length > 0 ? (
          <section aria-label="Your notes">
            <Label>Your notes</Label>
            <div className={styles.stack}>
              {view.userNotes.map((note) => <div key={note.id}>
                <time className="text-xs text-text-muted" dateTime={note.at}>{note.at}</time>
                <p className="whitespace-pre-wrap break-words">{note.text}</p>
              </div>)}
            </div>
          </section>
        ) : null}

        {view.decisions.length > 0 ? (
          <section aria-label="Decisions">
            <Label>Decisions</Label>
            <div className={styles.stack}>
              {view.decisions.map((decision) => (
                <DecisionCard key={decision.id || decision.title} decision={decision} />
              ))}
            </div>
            <StrayText lines={view.other.decisions} />
          </section>
        ) : null}

        {view.media.length > 0 ? (
          <section aria-label="Screenshots and video">
            <Label>Screenshots and video</Label>
            <TaskNoteMedia items={view.media} />
            <StrayText lines={view.other.media} />
          </section>
        ) : null}

        {view.bugs.length > 0 ? (
          <section aria-label="Bugs">
            <Label count={view.bugs.filter((b) => b.status === "open").length || undefined}>Bugs</Label>
            <div className={styles.stack}>
              {view.bugs.map((bug) => (
                <BugCard key={bug.id || bug.title} bug={bug} onOp={onOp} />
              ))}
            </div>
            <StrayText lines={view.other.bugs} />
          </section>
        ) : null}

        {view.poi.length > 0 ? (
          <section aria-label="Points of interest">
            <Label>Points of interest</Label>
            <ul className={styles.poi}>
              {view.poi.map((item) => (
                <li key={item.id || item.file}>
                  {item.file ? <code>{item.file}</code> : null}
                  {item.file && item.note.length ? <span>: </span> : null}
                  <span>{renderInline(item.note)}</span>
                </li>
              ))}
            </ul>
            <StrayText lines={view.other.poi} />
          </section>
        ) : null}

        {view.waypoints.length > 0 ? (
          <section aria-label="Waypoints">
            <Label>Waypoints</Label>
            <div className={styles.waypoints}>
              {view.waypoints.map((waypoint) => (
                <span key={waypoint.id || waypoint.title} className={cx(styles.pill, waypoint.done ? styles.ok : styles.muted)}>
                  {waypoint.done ? <Check size={12} aria-hidden /> : <Circle size={11} aria-hidden />}
                  <span>{waypoint.title}</span>
                </span>
              ))}
            </div>
            <StrayText lines={view.other.waypoints} />
          </section>
        ) : null}

        {view.log.length > 0 ? (
          <section aria-label="Log">
            <details className={styles.log} style={{ marginTop: 24 }}>
              <summary>
                Log ({view.log.length} {view.log.length === 1 ? "entry" : "entries"})
              </summary>
              <ol>
                {[...view.log].reverse().map((entry) => (
                  <li key={entry.id || `${entry.at}${entry.message}`}>
                    {entry.at ? <time>{entry.at}</time> : null}
                    <span>{entry.message}</span>
                  </li>
                ))}
              </ol>
            </details>
          </section>
        ) : null}
      </article>
      <div className={styles.freeform}>{children}</div>
    </div>
  );
}

export type { TaskNoteSectionKey };
