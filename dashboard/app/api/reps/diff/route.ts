import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { resolveOwnedRepo } from "@/lib/ownership/owned-repos";
import { readRep } from "@/lib/reps";
import { todayISO } from "@/lib/utils";

/**
 * Diff for today's cold-read rep, straight from the local clone. Takes no
 * parameters — the sha comes from the stored rep, so this can't be used to
 * show arbitrary commits. `--format=` keeps the commit message hidden; that
 * message is the rep's answer.
 */
export const GET = withErrorHandler(async () => {
  const rep = readRep(todayISO());
  if (rep?.material.kind !== "cold-read") {
    return NextResponse.json({ error: "Today's rep is not a cold read." }, { status: 404 });
  }
  const repo = await resolveOwnedRepo(rep.material.repo);
  if (!repo?.localPath) {
    return NextResponse.json({ error: `No local clone of ${rep.material.repo} found.` }, { status: 503 });
  }
  const result = await runGitRepoAsync(
    repo.localPath,
    ["show", "--no-color", "--no-ext-diff", "--format=", rep.material.sha],
    { timeout: 30_000 },
  );
  if (result.status !== 0) {
    return NextResponse.json({ error: "Could not load the commit diff." }, { status: 500 });
  }
  return NextResponse.json({ diff: result.stdout });
}, "reps.diff");
