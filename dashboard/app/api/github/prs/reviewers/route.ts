import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { isGithubCliAuthenticated, mapGithubCliError } from "@/lib/gh-exec";
import { invalidateGithubPrsCache } from "@/lib/github/prs";
import {
  fetchPrReviewerContext,
  parseGithubLogins,
  parseOwnerRepo,
  requestPrReviewers,
} from "@/lib/github/request-reviewers";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  repo: z.string().min(1),
  number: z.coerce.number().int().positive(),
});

const BodySchema = z.object({
  repo: z.string().min(1),
  number: z.coerce.number().int().positive(),
  reviewers: z.array(z.string()).min(1),
});

export const GET = withErrorHandler(async (req: NextRequest) => {
  const parsed = QuerySchema.safeParse({
    repo: req.nextUrl.searchParams.get("repo") ?? "",
    number: req.nextUrl.searchParams.get("number") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "repo and number are required" }, { status: 400 });
  }
  if (!parseOwnerRepo(parsed.data.repo)) {
    return NextResponse.json({ error: "Expected owner/name" }, { status: 400 });
  }
  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return NextResponse.json({ error: "GitHub CLI is not authenticated." }, { status: 503 });
  }
  try {
    const context = await fetchPrReviewerContext(parsed.data);
    return NextResponse.json(context);
  } catch (error) {
    const mapped = mapGithubCliError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}, "github.prs.reviewers.get");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  if (!parseOwnerRepo(parsed.data.repo)) {
    return NextResponse.json({ error: "Expected owner/name" }, { status: 400 });
  }
  const reviewers = parseGithubLogins(parsed.data.reviewers);
  if (reviewers.length === 0) {
    return NextResponse.json({ error: "Enter at least one valid GitHub username." }, { status: 400 });
  }
  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return NextResponse.json({ error: "GitHub CLI is not authenticated." }, { status: 503 });
  }
  try {
    const requested = await requestPrReviewers({
      repo: parsed.data.repo,
      number: parsed.data.number,
      reviewers,
    });
    invalidateGithubPrsCache();
    return NextResponse.json({ ok: true, requested });
  } catch (error) {
    const mapped = mapGithubCliError(error, "Couldn't request reviewers");
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}, "github.prs.reviewers.post");
