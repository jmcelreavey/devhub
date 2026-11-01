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
import { z } from "zod";
import { prAutoReview, prAutoReviewRead, prAutoReviewTarget, prAutoReviewTargetInput } from "../../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../../lib/actions/http";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { isGithubCliAuthenticated, mapGithubCliError } from "../../../../../lib/gh-exec";
import { reviewNoteActivityByPath } from "../../../../../lib/notes/review-index-server";
import { autoReviewConcurrency, hasSavedAutoReview, loadAutoReviewQueue, runAutoPrReview } from "../../../../../lib/github/auto-pr-review";

import { listAutoPrReviewRecords } from "../../../../../lib/github/auto-pr-review-state";
import { readAgentRun } from "../../../../../lib/agent-runs/store";


const BodySchema = prAutoReviewTargetInput;

function incompleteReviews() {
  return listAutoPrReviewRecords().filter(record => {
    const state = record.runId ? readAgentRun(record.runId)?.status.state : undefined;
    return record.runId && (!state || ["succeeded", "failed", "cancelled"].includes(state)) && !hasSavedAutoReview(record);
  }).map(record => ({ repo: record.repo, number: record.number, runId: record.runId, attempts: record.attempts ?? 1 }));
}

export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  const review = async () => {
    const response = await runReview(parsed.data);
    return { status: response.status, body: await response.json() };
  };
  if (parsed.data.url !== undefined) {
    return httpAction(prAutoReviewTarget, {
      input: () => parsed.data,
      context: () => ({ review }),
      response: (response) => Response.json(response.body, { status: response.status }),
    })(req);
  }
  return httpAction(prAutoReview, {
    input: () => ({ confirm: parsed.data.dryRun !== true, limit: parsed.data.limit }),
    context: () => ({ review }),
    response: ({ response }) => Response.json(response.body, { status: response.status }),
  })(req);
}, "github.prs.auto-review");

async function runReview(input: z.output<typeof BodySchema>) {
  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return Response.json(
      {
        dryRun: input.dryRun === true,
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
    const target = input.url;
    const result = await runAutoPrReview({
      ...queue,
      reviews: target ? queue.reviews.filter((row) => row.url === target) : queue.reviews,
      noteActivityByPath: reviewNoteActivityByPath(),
      dryRun: input.dryRun === true,
      concurrency: input.limit ?? autoReviewConcurrency(),
    });
    return Response.json({ ...result, configured: true });
  } catch (error) {
    console.error("[api:github:prs:auto-review]", error);
    const mapped = mapGithubCliError(error);
    return Response.json({ error: mapped.error }, { status: mapped.status });
  }
}

/** GET — dry-run candidate listing (same selection, no starts). */
export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const scope = new URL(req.url).searchParams.get("scope");
  return await prAutoReviewRead.handler({ scope }, { read: readAutoReview }) as Response;
}, "github.prs.auto-review.get");

async function readAutoReview(scope: string | null) {
  if (scope === "local") {
    return Response.json({ incomplete: incompleteReviews() });
  }

  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return Response.json({ configured: false, dryRun: true, started: [], skipped: [], errors: [], candidates: [] });
  }

  try {
    const result = await runAutoPrReview({
      ...(await loadAutoReviewQueue()),
      noteActivityByPath: reviewNoteActivityByPath(),
      dryRun: true,
      concurrency: autoReviewConcurrency(),
    });
    const incomplete = incompleteReviews();
    return Response.json({ ...result, incomplete, configured: true });
  } catch (error) {
    console.error("[api:github:prs:auto-review:get]", error);
    const mapped = mapGithubCliError(error);
    return Response.json({ error: mapped.error }, { status: mapped.status });
  }
}
