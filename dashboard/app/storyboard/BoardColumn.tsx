"use client";

import { Fragment, useEffect, useRef, type DragEvent } from "react";
import { ChevronRight } from "lucide-react";
import type { TaskNoteStatus } from "@shared/task-note/meta.ts";
import { moveCheck, type BoardCard, type BoardColumn as ColumnData } from "@/lib/storyboard/notes-board-shared";
import { NoteCard, type CardHandlers } from "./NoteCard";
import styles from "./storyboard.module.css";
import type { TaskWorkflow } from "@/lib/workflows/types";

/** The drag in flight, shared by every column. Columns take drops; the board writes the status. */
export interface ColumnDnd {
  dragging: BoardCard | null;
  target: TaskNoteStatus | null;
  /** Where in the target column the card would land (among the other cards), when dragging within its own column. */
  index: number | null;
  over: (status: TaskNoteStatus, index: number | null) => void;
  leave: (status: TaskNoteStatus) => void;
  drop: (status: TaskNoteStatus, index: number | null) => void;
  /** Open a collapsed column while a card hovers over it. */
  peek: (status: TaskNoteStatus) => void;
}

interface BoardColumnProps {
  column: ColumnData;
  cards: BoardCard[];
  collapsed: boolean;
  onToggle: () => void;
  focusedTask: string | null;
  busy: ReadonlySet<string>;
  handlers: CardHandlers;
  dnd: ColumnDnd;
  workflows?: ReadonlyMap<string, TaskWorkflow>;
  now: number;
}

const PEEK_MS = 350;

/** One note status. Empty columns collapse to a slim strip; click to expand, or hover a dragged card over it. */
export function BoardColumn({ column, cards, collapsed, onToggle, focusedTask, busy, handlers, dnd, workflows, now }: BoardColumnProps) {
  const panelId = `column-${column.status}`;
  const peekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(peekTimer.current), []);

  const { dragging } = dnd;
  // Within its own column a drag reorders (writes the card's rank); elsewhere it changes the status.
  const reordering = Boolean(dragging && dragging.status === column.status);
  const check = dragging && !reordering ? moveCheck(dragging, column.status) : null;
  const allowed = reordering || (check?.ok ?? false);
  const dropIndex = reordering && dnd.target === column.status ? dnd.index : null;

  /** Index among the column's other cards that the pointer is above. */
  function indexAt(event: DragEvent<HTMLElement>): number | null {
    if (!reordering || !dragging) return null;
    const others = [...event.currentTarget.querySelectorAll<HTMLElement>("article[id^='card-']")].filter((element) => element.id !== `card-${dragging.taskId}`);
    const at = others.findIndex((element) => {
      const rect = element.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    return at < 0 ? others.length : at;
  }
  const dropState = dragging && dnd.target === column.status && dragging.status !== column.status ? (allowed ? "ok" : "no") : undefined;
  // A refused column never fires `drop`, so the reason has to show while the card hovers it.
  const refusal = dropState === "no" && check && !check.ok ? check.reason : undefined;

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (!dragging) return;
    if (allowed) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
    const index = indexAt(event);
    if (dnd.target === column.status && dnd.index === index) return;
    dnd.over(column.status, index);
    if (reordering) return;
    clearTimeout(peekTimer.current);
    if (collapsed) peekTimer.current = setTimeout(() => dnd.peek(column.status), PEEK_MS);
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    // Moving between a column's own children fires leave on the column, and Chromium often sends no
    // relatedTarget at all; only a move onto something outside counts. Entering the next column, or
    // dragend, clears the rest.
    const next = event.relatedTarget;
    if (!(next instanceof Node) || event.currentTarget.contains(next)) return;
    clearTimeout(peekTimer.current);
    dnd.leave(column.status);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    clearTimeout(peekTimer.current);
    dnd.drop(column.status, indexAt(event));
  }

  return (
    <section
      className={styles.column}
      data-status={column.status}
      data-collapsed={collapsed || undefined}
      data-empty={cards.length === 0 || undefined}
      data-drop={dropState}
      data-reordering={dropIndex !== null || undefined}
      aria-label={column.label}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <h2 className={styles.columnHead}>
        <button type="button" className={styles.columnToggle} aria-expanded={!collapsed} aria-controls={panelId} onClick={onToggle}>
          <ChevronRight size={14} aria-hidden className={styles.chevron} />
          <span className={styles.columnLabel}>{column.label}</span>
          <span className={styles.columnCount}>{cards.length}</span>
        </button>
      </h2>
      {!collapsed ? (
        <div id={panelId} className={styles.columnCards}>
          {refusal ? <p className={styles.muted}>{refusal}</p> : null}
          {cards.length === 0 && !refusal ? <p className={styles.muted}>{dropState === "ok" ? "Drop to move here." : "Nothing here."}</p> : null}
          {(() => {
            let other = 0;
            return cards.map((card) => {
              const self = reordering && card.taskId === dragging?.taskId;
              const lineBefore = !self && dropIndex === other;
              if (!self) other += 1;
              return (
                <Fragment key={card.taskId}>
                  {lineBefore ? <div className={styles.dropLine} aria-hidden /> : null}
                  <NoteCard
                    workflow={workflows?.get(card.taskId)}
                    now={now}
                    card={card}
                    focused={focusedTask === card.taskId}
                    busy={busy.has(card.taskId)}
                    dragging={dragging?.taskId === card.taskId}
                    handlers={handlers}
                  />
                </Fragment>
              );
            });
          })()}
          {dropIndex !== null && dropIndex === cards.filter((card) => card.taskId !== dragging?.taskId).length ? <div className={styles.dropLine} aria-hidden /> : null}
        </div>
      ) : null}
    </section>
  );
}
