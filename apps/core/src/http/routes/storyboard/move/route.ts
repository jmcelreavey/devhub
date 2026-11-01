import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { storyboardMove, storyboardMoveInput } from "../../../../../../../packages/shared/actions/storyboard";
import { moveTaskCard } from "../../../../lib/storyboard/manual-move";
import { storyboardError, storyboardJson } from "../../../../lib/storyboard/http";


export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, storyboardMoveInput);
  if (!parsed.ok) return parsed.response;
  return httpAction(storyboardMove, {
    input: () => parsed.data,
    context: () => ({ move: async (input) => {
      try {
        const result = await moveTaskCard(input);
        return { status: result.ok ? 200 : 409, body: result };
      } catch (error) {
        const response = storyboardError(error);
        return { status: response.status, body: await response.json() };
      }
    } }),
    response: ({ status, body }) => storyboardJson(body, status),
  })(req);
}, "storyboard.move");
