"use client";

import { useState, type DragEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useTaskDetail } from "@/components/storyboard/TaskDetailProvider";
import { useTaskNoteComposer } from "@/components/tasks/AddNoteComposer";
import { hasLiveWork } from "@/lib/storyboard/next-action";
import { ScreenshotIndicator } from "@/components/storyboard/TaskContext";
import { FileText, Play } from "lucide-react";
import { TaskNotePills } from "@/components/notes/task-note/TaskNotePills";
import { ImageViewer } from "@/components/ui/ImageViewer";
import { ENTITY_CHIP_SELECTOR, RowMenuKebab } from "@/components/shell/ContextMenu";
import type { JevInfo } from "@/lib/qa/jev-summary";
import type { CardAttention } from "@/lib/storyboard/attention";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { STEP_LABEL } from "@/lib/storyboard/orchestration";
import { formatRelative } from "@/lib/utils";
import { costLabel as taskCostLabel } from "@/lib/storyboard/work-insights";
import { workStatus, type NextAction } from "@/lib/storyboard/next-action";
import { resolveWorkPresentation } from "@/lib/storyboard/work-summary";
import { WorkActionButton } from "@/components/storyboard/WorkActionButton";
import { useTaskActionPending } from "@/lib/storyboard/task-action";
import type { TaskWorkflow } from "@/lib/workflows/types";
import { storyboardHrefForTask } from "@/lib/storyboard/orchestration";
import styles from "./storyboard.module.css";

export interface CardHandlers {
  /** Alt+Left / Alt+Right on a focused card: the keyboard way to drag it one column over. */
  onStep: (card: BoardCard, direction: -1 | 1) => void;
  /** Alt+Up / Alt+Down: move the card one place up or down its column. */
  onReorder?: (card: BoardCard, direction: -1 | 1) => void;
  onDragStart: (card: BoardCard) => void;
  onDragEnd: () => void;
  onCreateNote: (card: BoardCard) => void;
  onAttention: (card: BoardCard, attention: CardAttention) => void;
  /** Auto mode's "UI change" toggle; null goes back to detection. */
  onUiToggle?: (card: BoardCard, ui: boolean | null) => void;
  /** To do cards: start the task on auto on the saved tiers, in one click. */
  onStartAuto?: (card: BoardCard, pauseAfterPlan?: boolean) => void;
  onApprovePlan?: (card: BoardCard) => void;
  onComplete?: (card: BoardCard) => void;
  /** Right-click, Shift+F10 or the context-menu key: the card's task menu at that point. */
  onMenu?: (card: BoardCard, x: number, y: number, host: HTMLElement) => void;
  /** Clicking the card's title opens its note over the board. */
  onOpenNote?: (card: BoardCard) => void;
  onCreatePr?: (card: BoardCard) => void;
  detailHref?: (card: BoardCard) => string;
  profile?: string;
}

const JEV_STATUS_LABEL: Record<JevInfo["status"], string> = { passed: "Passed", failed: "Failed", blocked: "Blocked", cancelled: "Cancelled" };

const ROLE_LABEL: Record<string, string> = { plan: "Plan", discuss: "Plan", implement: "Implement", verify: "Verify", review: "Review", "draft-pr": "PR" };

/** "≈$0.42", or tokens when the agent reports no price. Approximate by design. */
export function costLabel(costUsd?: number, tokens?: number): string | null {
  if (typeof costUsd === "number") return costUsd < 0.01 ? "<$0.01" : `≈$${costUsd.toFixed(2)}`;
  if (typeof tokens === "number") return tokens < 1000 ? `${tokens} tok` : `${Math.round(tokens / 1000)}k tok`;
  return null;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A blocked or cancelled run files no bugs, which is not the same as passing: say what happened. */
function jevVerdict(jev: JevInfo): string {
  if (jev.bugCount > 0) return jev.status === "failed" ? plural(jev.bugCount, "bug") : `${JEV_STATUS_LABEL[jev.status]} · ${plural(jev.bugCount, "bug")}`;
  return jev.status === "passed" ? "No bugs" : JEV_STATUS_LABEL[jev.status];
}

/**
 * "Changes the UI" in the card's details. Detection comes from the changed
 * files and the plan's paths; ticking it overrides that, and "Use detection"
 * (or ticking it back to what was detected) clears the override.
 */
function UiToggle({ card, busy, onToggle }: { card: BoardCard; busy: boolean; onToggle: NonNullable<CardHandlers["onUiToggle"]> }) {
  const ui = card.auto?.ui;
  const value = ui?.value ?? false;
  return (
    <div className={styles.detailRow}>
      <label className={styles.check}>
        <input type="checkbox" checked={value} disabled={busy} onChange={(event) => onToggle(card, ui && event.target.checked === ui.detected ? null : event.target.checked)} />
        <span>Changes the UI (Jev records before and after videos)</span>
      </label>
      <small className={styles.muted}>
        {ui?.override !== undefined ? (
          <>You set this. <button type="button" className={styles.linkButton} disabled={busy} onClick={() => onToggle(card, null)}>Use detection</button></>
        ) : ui ? `Detected: ${ui.reason}` : "Not checked yet."}
      </small>
    </div>
  );
}

const RUN_STATUS_LABEL: Record<string, string> = { queued: "queued", running: "running", paused: "paused", done: "finished", failed: "failed", abandoned: "stopped" };

/** The card's one status line. Auto mode says where it is; otherwise the agent and the last update. */
export function statusLine(card: BoardCard, now: number): string {
  return workStatus(card, now);
}

/** A To do card that nothing else is driving: Start on auto is its one primary action. */
export function canStartAuto(card: BoardCard, now: number): boolean {
  return resolveWorkPresentation(card, undefined, now).action?.kind === "start-auto";
}

function CreateNoteButton({ card, busy, onCreateNote }: { card: BoardCard; busy: boolean; onCreateNote: CardHandlers["onCreateNote"] }) {
  return (
    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onCreateNote(card)}>
      <FileText size={12} aria-hidden />Create note
    </button>
  );
}

/** Shared by every card; rendered once by the board. */
export const MOVE_HINT_ID = "storyboard-move-hint";

export function NoteCard({ card, focused, busy: boardBusy, dragging = false, handlers, workflow, now }: { card: BoardCard; focused: boolean; busy: boolean; dragging?: boolean; handlers: CardHandlers; workflow?: TaskWorkflow; now: number }) {
  const detail = useTaskDetail();
  const note = useTaskNoteComposer({ taskId: card.taskId, title: card.title, profile: handlers.profile, running: hasLiveWork(card) });
  const { attention, jev, counts } = card;
  const actionPending = useTaskActionPending(card.taskId, handlers.profile);
  const busy = boardBusy || actionPending;
  const presentation = resolveWorkPresentation(card, workflow, now);
  const primary = presentation.action;
  const onAction = (action: NextAction) => {
    if (action.kind === "start-auto") handlers.onStartAuto?.(card, action.pauseAfterPlan);
    else if (action.kind === "approve-plan") handlers.onApprovePlan?.(card);
    else if (action.kind === "create-pr") handlers.onCreatePr?.(card);
    else if (action.kind === "finish" || action.kind === "done") handlers.onComplete?.(card);
    else if ("attention" in action) handlers.onAttention(card, action.attention);
  };
  const questionsHref = card.noteHref ? `${card.noteHref}#task-note-questions` : undefined;
  // A task ticked done in Tasks stays Done whatever the note says, so it does not move.
  const movable = !card.taskDone && !busy;
  const startable = Boolean(handlers.onStartAuto) && primary?.kind === "start-auto";
  const [viewing, setViewing] = useState(false);
  // Older payloads (and task-only cards) have no image list; the thumbnail alone is still viewable.
  const images = card.images?.length ? card.images.map((image) => ({ url: image.url, caption: image.caption, name: image.name, ...(image.source === "jev" ? { tag: "Jev" } : {}) })) : card.screenshot ? [{ url: card.screenshot.url, caption: card.screenshot.caption }] : [];
  function onDragStart(event: DragEvent<HTMLElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.taskId);
    handlers.onDragStart(card);
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Only on the card itself, so links and buttons inside keep their own keys.
    if (event.target !== event.currentTarget) return;
    if (handlers.onMenu && (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      handlers.onMenu(card, rect.left + 12, rect.top + 28, event.currentTarget);
      return;
    }
    if (!event.altKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      handlers.onStep(card, event.key === "ArrowLeft" ? -1 : 1);
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && handlers.onReorder && !busy) {
      event.preventDefault();
      handlers.onReorder(card, event.key === "ArrowUp" ? -1 : 1);
    }
  }
  return (
    <article
      id={`card-${card.taskId}`}
      className={styles.card}
      data-attention={presentation.needsYou ? attention?.reason ?? "awaiting" : undefined}
      data-focused={focused || undefined}
      data-task-only={card.noteHref ? undefined : true}
      data-dragging={dragging || undefined}
      aria-label={card.title}
      tabIndex={0}
      draggable={movable}
      aria-keyshortcuts={[movable ? "Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown" : "", handlers.onMenu ? "Shift+F10" : ""].filter(Boolean).join(" ") || undefined}
      aria-describedby={movable ? MOVE_HINT_ID : undefined}
      onDragStart={movable ? onDragStart : undefined}
      onDragEnd={handlers.onDragEnd}
      onKeyDown={onKeyDown}
      onContextMenu={handlers.onMenu ? (event) => {
        // Entity chips have their own menu, as on the Today's-tasks rows.
        if (event.target instanceof Element && event.target.closest(ENTITY_CHIP_SELECTOR)) return;
        event.preventDefault();
        handlers.onMenu?.(card, event.clientX, event.clientY, event.currentTarget);
      } : undefined}
    >
      {viewing && images.length > 0 ? <ImageViewer label={`Images for ${card.title}`} images={images} onClose={() => setViewing(false)} /> : null}
      <div className={styles.body}>
        {card.noteHref || handlers.onOpenNote ? (
          <Link
            className={styles.title}
            href={handlers.detailHref?.(card) ?? card.noteHref ?? storyboardHrefForTask(card.taskId)}
            aria-haspopup={handlers.onOpenNote ? "dialog" : undefined}
            onClick={handlers.onOpenNote ? (event) => {
              // Cmd/Ctrl/Shift-click still opens Notes in a new tab or window.
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              handlers.onOpenNote?.(card);
            } : undefined}
          >{card.title}</Link>
        ) : (
          <span className={styles.title}>{card.title}</span>
        )}
        {presentation.needsYou ? <p className={styles.attention} data-reason={attention?.reason ?? "awaiting"} role="status">{presentation.status}</p> : null}
        {card.summary.join(" ").trim() ? <p className={`${styles.progress} ${styles.preview}`}>{card.summary.join(" ")}</p> : null}
        <ScreenshotIndicator card={card} onOpen={() => setViewing(true)} />
        {!presentation.needsYou ? <p className={styles.progress} data-waiting={card.auto?.waiting?.kind} title={card.auto?.noPreview ? `No preview: ${card.auto.noPreview}` : undefined}>{presentation.status}</p> : null}
        {/* Keep the next action beside its alternative, below the task title and status. */}
        {primary ? (
          <div className={styles.foot}>
            <WorkActionButton action={primary} pending={busy} onAction={onAction} onOpen={handlers.onOpenNote ? () => handlers.onOpenNote?.(card) : undefined} detailHref={handlers.detailHref?.(card)} className={startable ? styles.startAuto : undefined} />
            {primary.kind === "approve-plan" ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => detail?.openTask(card.taskId, "revise-plan")}>Revise</button> : null}
          </div>
        ) : !card.noteHref && !attention && !card.auto ? <div className={styles.foot}><CreateNoteButton card={card} busy={busy} onCreateNote={handlers.onCreateNote} /></div> : null}
        {taskCostLabel(card.costUsd) ? <span className={styles.muted} title="Reported task cost">{taskCostLabel(card.costUsd)}</span> : null}
        <div className={styles.noteUtilities}>
        <details className={styles.details}>
          <summary>Details</summary>
          <div className={styles.detailsBody}>
            <TaskNotePills
              label={`Details for ${card.title}`}
              // No status pill: the column is the status, and dragging the card changes it. The note keeps its own picker.
              openQuestions={counts.openQuestions}
              questionsHref={questionsHref}
              tags={card.tags}
              links={card.links}
              models={card.models}
              maxLinks={3}
            />
            {card.unknownStatus ? <p className={styles.muted}>The note says status “{card.unknownStatus}”, which isn’t a board column.</p> : null}
            {card.summary.length > 0 ? (
              <div className={styles.summary}>{card.summary.map((line) => <p key={line}>{line}</p>)}</div>
            ) : null}
            {counts.decisions + counts.openQuestions + counts.openBugs > 0 ? (
              <div className={styles.counts}>
                {counts.decisions > 0 ? <span>{plural(counts.decisions, "decision")}</span> : null}
                {counts.openQuestions > 0 ? <span>{plural(counts.openQuestions, "open question")}</span> : null}
                {counts.openBugs > 0 ? <span data-tone="warn">{plural(counts.openBugs, "open bug")}</span> : null}
              </div>
            ) : null}
            {card.auto?.waiting && (card.auto.waiting.kind === "queued" || card.auto.waiting.kind === "questions") ? <p className={styles.muted}>{card.auto.waiting.reason}</p> : null}
            {card.auto && handlers.onUiToggle ? <UiToggle card={card} busy={busy} onToggle={handlers.onUiToggle} /> : null}
            {card.auto?.noPreview ? <p className={styles.muted}>No preview, so no videos: {card.auto.noPreview}</p> : null}
            {card.auto?.previewStarting ? <p className={styles.muted}>Starting the preview for Jev…</p> : null}
            {card.auto?.previewUrl ? <p className={styles.muted}><a href={card.auto.previewUrl} target="_blank" rel="noopener noreferrer">Open the preview</a></p> : null}
            {jev ? (
              <div className={styles.jev} data-status={jev.status}>
                <span className={styles.jevLabel}>Jev</span>
                <span data-tone={jev.bugCount > 0 || jev.status !== "passed" ? "warn" : "ok"}>{jevVerdict(jev)}</span>
                {jev.beforeVideo ? <a href={jev.beforeVideo} target="_blank" rel="noopener noreferrer"><Play size={11} aria-hidden /> Before</a> : null}
                {jev.afterVideo ? <a href={jev.afterVideo} target="_blank" rel="noopener noreferrer"><Play size={11} aria-hidden /> After</a> : null}
                <Link href={jev.receiptHref}>Receipt</Link>
                {costLabel(jev.costUsd, jev.tokens) ? <span title="Jev's estimated model spend">{costLabel(jev.costUsd, jev.tokens)}</span> : null}
              </div>
            ) : null}
            {card.steps.length > 0 ? (
              <ul className={styles.stepLog} aria-label="Agent runs">
                {card.steps.map((step) => {
                  const cost = costLabel(step.costUsd, step.tokens);
                  return (
                    <li key={step.runId} data-status={step.status} title={`${RUN_STATUS_LABEL[step.status] ?? step.status}${step.provider ? ` · ${step.provider}` : ""}${step.tier ? ` · ${step.tier} tier` : ""}`}>
                      <span>{step.label ?? ROLE_LABEL[step.role] ?? step.role}</span>
                      {step.tier ? <b>{step.tier}</b> : null}
                      <span className={styles.stepModel}>{step.model || step.provider || "default model"}</span>
                      {cost ? <span>{cost}</span> : null}
                      {step.tierReason ? <small className={styles.tierReason}>{step.tierReason}</small> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {card.tiers ? (
              <div className={styles.tierLine} role="group" aria-label="Model tiers">
                {card.tiers.map((entry) => (
                  <span key={entry.step} title={entry.label}>
                    {STEP_LABEL[entry.step]} {entry.active ? <b>{entry.tier}</b> : entry.tier}
                  </span>
                ))}
              </div>
            ) : null}
            {card.agentNoteUpdate ? <p className={styles.muted} title={`Last agent edit: ${card.agentNoteUpdate.op}`}>An agent edited the note {formatRelative(Date.parse(card.agentNoteUpdate.at))}</p> : null}
            {!card.noteHref && (attention || card.auto || startable) ? <div className={styles.foot}><CreateNoteButton card={card} busy={busy} onCreateNote={handlers.onCreateNote} /></div> : null}
          </div>
        </details>
        {!card.task?.handoff ? <span className={styles.noteTrigger}>{note.trigger}</span> : null}
        {handlers.onMenu && card.task ? <RowMenuKebab label={`Actions for ${card.title}`} onOpen={(x, y) => {
          const host = document.getElementById(`card-${card.taskId}`);
          if (host) handlers.onMenu?.(card, x, y, host);
        }} /> : null}
        </div>
        {!card.task?.handoff ? note.composer : null}
      </div>
    </article>
  );
}
