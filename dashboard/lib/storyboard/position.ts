import { rankBetween, isRank } from "@shared/task-note/rank.ts";
import { updateTaskNoteSections } from "@/lib/tasks/task-note-sections";
import { StoryboardError } from "./errors";
import { readNotesBoard } from "./notes-board";
import { rankPlan, type BoardCard } from "./notes-board-shared";

export interface PositionInput {
  taskId: string;
  /** Put the card just before this card (same column). */
  before?: string;
  /** Put the card just after this card (same column). */
  after?: string;
  /** "top" or "bottom" of its column. */
  to?: "top" | "bottom";
  /** An explicit rank instead (lowercase base-36, see shared/task-note/rank.ts). */
  rank?: string;
}

/** The ranks to write for a position request, against the board as it is now. Pure apart from `cards`. */
export function planPosition(cards: BoardCard[], input: PositionInput): Array<{ taskId: string; rank: string }> {
  const card = cards.find((item) => item.taskId === input.taskId);
  if (!card) throw new StoryboardError(`No card for task ${input.taskId} on the board.`, 404);
  if (input.rank !== undefined) {
    if (!isRank(input.rank)) throw new StoryboardError("rank must be lowercase letters and digits, not ending in 0.", 400);
    return [{ taskId: card.taskId, rank: input.rank }];
  }
  const column = cards.filter((item) => item.status === card.status);
  const others = column.filter((item) => item.taskId !== card.taskId);
  const anchorId = input.before ?? input.after;
  let index: number;
  if (anchorId) {
    const anchor = others.findIndex((item) => item.taskId === anchorId);
    if (anchor < 0) throw new StoryboardError(`Task ${anchorId} isn't another card in the ${card.status} column.`, 400);
    index = input.before ? anchor : anchor + 1;
  } else if (input.to) {
    index = input.to === "top" ? 0 : others.length;
  } else {
    throw new StoryboardError("Give before, after, to (top|bottom) or rank.", 400);
  }
  return rankPlan(column, card, index, rankBetween);
}

/** Write a card's position: normally one note's rank, never a card in another column. */
export function setCardPosition(input: PositionInput): { taskId: string; writes: Array<{ taskId: string; rank: string }> } {
  const board = readNotesBoard({ doneWindowDays: null });
  const writes = planPosition(board.cards, input);
  const byId = new Map(board.cards.map((item) => [item.taskId, item]));
  for (const write of writes) {
    const card = byId.get(write.taskId)!;
    updateTaskNoteSections(card.notePath ? { notePath: card.notePath } : { taskId: card.taskId, date: card.date }, { op: "set_rank", rank: write.rank });
  }
  return { taskId: input.taskId, writes };
}
