import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { storyboardReviewNotes } from "../../../../../../../packages/shared/actions/storyboard";
import { getReviewNoteIndex } from "../../../../lib/notes/review-index-server";


/** Which PR review notes exist, so the board can show the PRs the user owns the review of that already have one. */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return httpAction(storyboardReviewNotes, {
    input: () => ({}),
    context: () => ({ read: () => ({ notes: getReviewNoteIndex().map(({ path, title, repo, prNumbers }) => ({ path, title, repo, prNumbers })) }) }),
    response: (body) => Response.json(body),
  })(req);
}, "storyboard.pr-review-notes.get");
