import { repsDiff } from "../../../../../../../packages/shared/actions/reps";
import { withErrorHandler } from "../../../../lib/api-utils";
import { runGitRepoAsync } from "../../../../lib/git/repo-local";
import { resolveOwnedRepo } from "../../../../lib/ownership/owned-repos";
import { readRep } from "../../../../lib/reps/index";
import { todayISO } from "../../../../../../../packages/shared/utils.ts";

/**
 * Diff for today's cold-read rep, straight from the local clone. Takes no
 * parameters — the sha comes from the stored rep, so this can't be used to
 * show arbitrary commits. `--format=` keeps the commit message hidden; that
 * message is the rep's answer.
 */
export const GET = withErrorHandler(async () => {
  return await repsDiff.handler(repsDiff.input.parse({}), { execute: readDiff }) as Response;
}, "reps.diff");

async function readDiff() {
  const rep = readRep(todayISO());
  if (rep?.material.kind !== "cold-read") {
    return Response.json({ error: "Today's rep is not a cold read." }, { status: 404 });
  }
  const repo = await resolveOwnedRepo(rep.material.repo);
  if (!repo?.localPath) {
    return Response.json({ error: `No local clone of ${rep.material.repo} found.` }, { status: 503 });
  }
  const result = await runGitRepoAsync(
    repo.localPath,
    ["show", "--no-color", "--no-ext-diff", "--format=", rep.material.sha],
    { timeout: 30_000 },
  );
  if (result.status !== 0) {
    return Response.json({ error: "Could not load the commit diff." }, { status: 500 });
  }
  return Response.json({ diff: result.stdout });
}
