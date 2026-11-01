import { repoWorktreeReport } from "../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../lib/actions/http";
import { requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { readWorktreeReport } from "../../../../lib/repos/worktree-report";
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return httpAction(repoWorktreeReport, {
    input: () => ({}),
    context: () => ({ read: readWorktreeReport }),
    response: (report) => Response.json({ report }),
  })(req);
}, "worktrees.report");
