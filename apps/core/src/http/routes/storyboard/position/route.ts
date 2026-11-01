import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { storyboardPosition, storyboardPositionInput } from "../../../../../../../packages/shared/actions/storyboard";
import { storyboardError, storyboardJson } from "../../../../lib/storyboard/http";
import { setCardPosition } from "../../../../lib/storyboard/position";


const PositionSchema = storyboardPositionInput.extend({
  taskId: z.string().trim().min(1).max(128),
  before: z.string().trim().min(1).max(128).optional(),
  after: z.string().trim().min(1).max(128).optional(),
  to: z.enum(["top", "bottom"]).optional(),
  rank: z.string().trim().min(1).max(64).optional(),
}).strict();

/** Move a card within its column (MCP storyboard_position). Writes the card's rank in its note's task-meta. */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, PositionSchema);
  if (!parsed.ok) return parsed.response;
  return httpAction(storyboardPosition, {
    input: () => parsed.data,
    context: () => ({ requireSingleChoice: false, set: async (input) => {
      try {
        return { status: 200, body: await setCardPosition(input) };
      } catch (error) {
        const response = storyboardError(error);
        return { status: response.status, body: await response.json() };
      }
    } }),
    response: ({ status, body }) => storyboardJson(body, status),
  })(req);
}, "storyboard.position.post");
