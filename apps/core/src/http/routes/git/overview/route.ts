import { withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { coreGitOverview } from "../../../../../../../packages/shared/actions/repos";
import { readGitOverview } from "../../../../lib/repos/git-overview";

/**
 * Cross-repo git snapshot for the Git hub rail. Cached for 60s server-side;
 * `?refresh=1` bypasses the cache (the UI's explicit refresh action).
 */
export const GET = withErrorHandler(async (req: Request) => httpAction(coreGitOverview, {
  input: () => ({ refresh: new URL(req.url).searchParams.get("refresh") === "1" }),
  context: () => ({ read: readTarget }),
  response: (result) => Response.json(result.body, { status: result.status }),
})(req), "git overview");

async function readTarget(input: { refresh?: boolean }) {
  return { status: 200, body: await readGitOverview({ refresh: input.refresh === true }) };
}
