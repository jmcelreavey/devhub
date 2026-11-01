import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { storyboardAttention } from "../../../../../../../packages/shared/actions/storyboard";
import { storyboardError, storyboardJson } from "../../../../lib/storyboard/http";
import { readNotesBoard } from "../../../../lib/storyboard/notes-board";


/** Stuck cards (waiting on the user, failing, idle agent) with the one action that unblocks each. Used by the MCP server. */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return httpAction(storyboardAttention, {
    input: () => ({}),
    context: () => ({ read: async () => {
      try {
        const cards = readNotesBoard().cards.flatMap((card) => card.attention
          ? [{ taskId: card.taskId, title: card.title, status: card.status, noteHref: card.noteHref, runId: card.run?.runId, ...card.attention }]
          : []);
        return { status: 200, body: { cards } };
      } catch (error) {
        const response = storyboardError(error);
        return { status: response.status, body: await response.json() };
      }
    } }),
    response: ({ status, body }) => storyboardJson(body, status),
  })(req);
}, "storyboard.attention.get");
