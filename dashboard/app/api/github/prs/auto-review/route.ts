/**
 * POST /api/github/prs/auto-review — start agent reviews for review-requested PRs.
 *
 * Same prompt + note path as the UI "Review with agent" action. Never posts
 * GitHub review comments. Auth: requireDashboardAuth (same-origin / secret).
 *
 * Body: `{ dryRun?: boolean, limit?: number, url?: string }` — `url` limits the
 * pass to that PR (the UI confirms a specific PR, then starts exactly it).
 * Returns: `{ dryRun, started, skipped, errors, candidates? }`
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { isGithubCliAuthenticated, mapGithubCliError } from "@/lib/gh-exec";
import { reviewNoteActivityByPath } from "@/lib/notes/review-index-server";
import { autoReviewConcurrency, loadAutoReviewQueue, runAutoPrReview } from "@/lib/github/auto-pr-review";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  dryRun: z.boolean().optional(),
  /** Cap how many reviews to start this call (1–2). */
  limit: z.number().int().min(1).max(2).optional(),
  url: z.string().url().max(500).optional(),
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return NextResponse.json(
      {
        dryRun: parsed.data.dryRun === true,
        started: [],
        skipped: [],
        errors: [{ repo: "", number: 0, url: "", error: "GitHub CLI not authenticated — run `gh auth login`." }],
        configured: false,
      },
      { status: 503 },
    );
  }

  try {
    const queue = await loadAutoReviewQueue();
    const target = parsed.data.url;
    const result = await runAutoPrReview({
      ...queue,
      reviews: target ? queue.reviews.filter((row) => row.url === target) : queue.reviews,
      noteActivityByPath: reviewNoteActivityByPath(),
      dryRun: parsed.data.dryRun === true,
      concurrency: parsed.data.limit ?? autoReviewConcurrency(),
    });
    return NextResponse.json({ ...result, configured: true });
  } catch (error) {
    console.error("[api:github:prs:auto-review]", error);
    const mapped = mapGithubCliError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}, "github.prs.auto-review");

/** GET — dry-run candidate listing (same selection, no starts). */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return NextResponse.json({ configured: false, dryRun: true, started: [], skipped: [], errors: [], candidates: [] });
  }

  try {
    const result = await runAutoPrReview({
      ...(await loadAutoReviewQueue()),
      noteActivityByPath: reviewNoteActivityByPath(),
      dryRun: true,
      concurrency: autoReviewConcurrency(),
    });
    return NextResponse.json({ ...result, configured: true });
  } catch (error) {
    console.error("[api:github:prs:auto-review:get]", error);
    const mapped = mapGithubCliError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}, "github.prs.auto-review.get");
