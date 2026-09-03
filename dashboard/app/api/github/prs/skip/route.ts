import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { listSkippedPrs, skipPr, unskipPr } from "@/lib/github/skipped-prs";
import { dropPrFromGithubPrsCache, invalidateGithubPrsCache } from "@/lib/github/prs";

export const dynamic = "force-dynamic";

const SkipBodySchema = z.object({
  url: z.string().trim().startsWith("https://"),
  updatedAt: z.string().optional(),
  repo: z.string().default(""),
  number: z.number().default(0),
  title: z.string().default(""),
});

export async function GET() {
  return NextResponse.json({ skipped: listSkippedPrs() });
}

export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, SkipBodySchema);
  if (!parsed.ok) return parsed.response;
  await skipPr(parsed.data);
  // Prune the row rather than dumping the cache: a full invalidation makes the
  // next poll re-run two `gh` searches, and skipping several PRs in a row then
  // trips GitHub's secondary rate limit.
  dropPrFromGithubPrsCache(parsed.data.url);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  await unskipPr(url);
  invalidateGithubPrsCache();
  return NextResponse.json({ ok: true });
}
