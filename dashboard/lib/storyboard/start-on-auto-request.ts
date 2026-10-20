import type { BoardCard } from "./notes-board-shared";

type Handler = (card: BoardCard) => void;
let handler: Handler | null = null;

/** The one place that can show the launch sheet registers here (TaskDetailProvider). */
export function registerStartOnAutoHandler(next: Handler): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

/** Ask for the launch sheet for this task's Start on auto. False when nothing can show it, so the caller starts directly. */
export function requestStartOnAuto(card: BoardCard): boolean {
  if (!handler || !card.task || card.taskDone || card.task.abandonedAt) return false;
  handler(card);
  return true;
}
