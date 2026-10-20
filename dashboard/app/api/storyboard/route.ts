import { NextRequest } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { storyboardError, storyboardJson } from "@/lib/storyboard/http";
import { readNotesBoard } from "@/lib/storyboard/notes-board";
import { cardMatchesFilters, filtersFromParams } from "@/lib/storyboard/notes-board-shared";

export const dynamic = "force-dynamic";

/**
 * The board: task notes grouped by note status. `?done=all` includes done cards
 * older than the default 14-day window. Cards carry their `attention`.
 * `?repo=`, `?tag=`, `?jira=` (a key, or `none`) and `?parentJira=` narrow the
 * cards and the column counts, the same filters as the board's URL.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const board = readNotesBoard({ doneWindowDays: req.nextUrl.searchParams.get("done") === "all" ? null : undefined });
    const filters = filtersFromParams(req.nextUrl.searchParams);
    if (Object.keys(filters).length === 0) return storyboardJson(board);
    const cards = board.cards.filter((card) => cardMatchesFilters(card, filters));
    return storyboardJson({ ...board, cards, columns: board.columns.map((column) => ({ ...column, count: cards.filter((card) => card.status === column.status).length })) });
  } catch (error) {
    return storyboardError(error);
  }
}, "storyboard.get");
