import { requireDashboardAuth, withErrorHandler } from "../../../lib/api-utils";
import { httpAction } from "../../../lib/actions/http";
import { storyboardBoard } from "../../../../../../packages/shared/actions/storyboard";
import { storyboardError, storyboardJson } from "../../../lib/storyboard/http";
import { readNotesBoard } from "../../../lib/storyboard/notes-board";
import { cardMatchesFilters, filtersFromParams } from "../../../../../../packages/shared/ui-lib/storyboard/notes-board-shared";


/**
 * The board: task notes grouped by note status. `?done=all` includes done cards
 * older than the default 14-day window. Cards carry their `attention`.
 * `?repo=`, `?tag=`, `?jira=` (a key, or `none`) and `?parentJira=` narrow the
 * cards and the column counts, the same filters as the board's URL.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return httpAction(storyboardBoard, {
    input: () => ({}),
    context: () => ({ read: async () => {
      try {
        const board = readNotesBoard({ doneWindowDays: new URL(req.url).searchParams.get("done") === "all" ? null : undefined });
        const filters = filtersFromParams(new URL(req.url).searchParams);
        if (Object.keys(filters).length === 0) return { status: 200, body: board };
        const cards = board.cards.filter((card) => cardMatchesFilters(card, filters));
        return { status: 200, body: { ...board, cards, columns: board.columns.map((column) => ({ ...column, count: cards.filter((card) => card.status === column.status).length })) } };
      } catch (error) {
        const response = storyboardError(error);
        return { status: response.status, body: await response.json() };
      }
    } }),
    response: ({ status, body }) => storyboardJson(body, status),
  })(req);
}, "storyboard.get");
