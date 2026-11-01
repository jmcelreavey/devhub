import { setupGitCheck } from "../../../../../../../packages/shared/actions/setup";
import { checkGit } from "../../../../lib/setup/git-check";
import { clearGitAvailabilityCache } from "../../../../lib/setup/git-availability";



/** Is `git` installed where DevHub runs, and what would install it? Read-only. */
export async function GET() {
  return await setupGitCheck.handler({}, { execute: async () => {
    clearGitAvailabilityCache();
    return Response.json(await checkGit(), { headers: { "Cache-Control": "no-store" } });
  } }) as Response;
}
