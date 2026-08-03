import { NextResponse, type NextRequest } from "next/server";
import { parseCommitRefs } from "@/lib/git/commit-refs";
import { isSafeCommitRef } from "@/lib/git/ref-safety";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { matchReviewNotes, type ReviewNoteMatch } from "@/lib/notes/review-index";
import { getReviewNoteIndex } from "@/lib/notes/review-index-server";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

export const dynamic = "force-dynamic";

export interface CommitContextPayload {
  commit: string;
  /** Tracker ids named by the commit, for direct Jira links. */
  tickets: string[];
  prNumbers: number[];
  notes: ReviewNoteMatch[];
}

/**
 * The "why is this like this" endpoint.
 *
 * A commit message names a PR or a ticket; the review note for that PR is where
 * the reasoning actually lives. Git alone can't make that jump and neither can
 * any hosted tool, because the notes are local.
 */
export async function GET(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const commit = req.nextUrl.searchParams.get("commit")?.trim() || "";
  if (!commit || !isSafeCommitRef(commit)) {
    return NextResponse.json({ error: "Invalid commit" }, { status: 400 });
  }

  // Subject + body: the ticket is often only in the body of a squashed commit.
  const meta = await runGitRepoAsync(resolved.repoRoot, [
    "show",
    "-s",
    "--format=%s%n%b",
    commit,
  ]);
  if (meta.status !== 0) return gitFail(meta, "Commit not found");

  const message = meta.stdout || "";
  const { prNumbers, tickets } = parseCommitRefs(message);
  const notes = matchReviewNotes(getReviewNoteIndex(), name, message);

  return NextResponse.json({ commit, tickets, prNumbers, notes } satisfies CommitContextPayload, {
    headers: { "cache-control": "no-store" },
  });
}
