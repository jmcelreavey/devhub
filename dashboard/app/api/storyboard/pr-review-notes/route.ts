import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { getReviewNoteIndex } from "@/lib/notes/review-index-server";

export const dynamic = "force-dynamic";

/** Which PR review notes exist, so the board can show the PRs John owns the review of that already have one. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ notes: getReviewNoteIndex().map(({ path, title, repo, prNumbers }) => ({ path, title, repo, prNumbers })) });
}, "storyboard.pr-review-notes.get");
