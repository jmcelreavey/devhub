import { NextResponse, type NextRequest } from "next/server";
import type { EntityRef } from "@/lib/entity-note";
import { parseCommitRefs } from "@/lib/git/commit-refs";
import { isSafeCommitRef } from "@/lib/git/ref-safety";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { matchReviewNotes, type ReviewNoteMatch } from "@/lib/notes/review-index";
import { getReviewNoteIndex } from "@/lib/notes/review-index-server";
import { buildGraph, neighbours } from "@/lib/recall/graph";
import { loadIndex } from "@/lib/recall/store";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

export const dynamic = "force-dynamic";

export interface CommitContextPayload {
  commit: string;
  /** Tracker ids named by the commit, for direct Jira links. */
  tickets: string[];
  prNumbers: number[];
  notes: ReviewNoteMatch[];
  /** `owner/name` of the GitHub remote, when resolvable — hrefs the PR numbers. */
  prRepo: string | null;
  /**
   * Derived co-occurrence neighbourhood of this commit from the recall graph:
   * PRs, tickets, tags and notes that showed up around this SHA. Explicit
   * review-note matches above carry intent; these carry evidence.
   */
  related: EntityRef[];
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

  // The graph keys on full SHAs only; short refs must resolve before lookup.
  const shaOut = await runGitRepoAsync(resolved.repoRoot, ["rev-parse", `${commit}^{commit}`]);
  const fullSha = shaOut.status === 0 ? shaOut.stdout.trim() : "";

  // Remote slug turns bare squash-merge PR numbers into real GitHub links.
  const remote = await runGitRepoAsync(resolved.repoRoot, ["remote", "get-url", "origin"]);
  let prRepo: string | null = null;
  if (remote.status === 0) {
    const m = remote.stdout.trim().match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
    prRepo = m?.[1] ?? null;
  }

  const message = meta.stdout || "";
  const { prNumbers, tickets } = parseCommitRefs(message);
  const notes = matchReviewNotes(getReviewNoteIndex(), name, message);
  const related = recallRelated(fullSha);

  return NextResponse.json(
    { commit, tickets, prNumbers, notes, prRepo, related } satisfies CommitContextPayload,
    { headers: { "cache-control": "no-store" } },
  );
}

/** Neighbours of `repo:commit:<sha>` in the derived graph; [] on any failure. */
type CommitGraph = ReturnType<typeof buildGraph>;
/** ponytail: per-process cache keyed on index build time; rebuilds are ~100ms if it ever goes stale */
let graphCache: { key: string; graph: CommitGraph } | null = null;

function recallRelated(fullSha: string): EntityRef[] {
  if (!/^[0-9a-f]{40}$/.test(fullSha)) return [];
  try {
    const index = loadIndex();
    if (!index) return [];
    const key = index.manifest.builtAt;
    if (!graphCache || graphCache.key !== key) {
      graphCache = { key, graph: buildGraph(index.chunks, { minWeight: 1 }) };
    }
    return neighbours(graphCache.graph, `repo:commit:${fullSha}`, 8)
      .map((n) => n.node.ref)
      .filter((ref) => ref.kind !== "repo");
  } catch {
    return [];
  }
}
