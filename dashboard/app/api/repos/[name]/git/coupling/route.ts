import { NextResponse, type NextRequest } from "next/server";
import type { CouplingSuggestion } from "@/lib/git/change-coupling";
import { analyzeChangeImpact } from "@/lib/repos/change-impact";
import { isSafeRepoRelPath } from "@/lib/git/ref-safety";
import { withScannedRepo, type RepoParams } from "../_shared";

export const dynamic = "force-dynamic";

export interface CouplingPayload {
  suggestions: CouplingSuggestion[];
  commitsAnalysed: number;
  domains: { label: string; changedFiles: number }[];
  reviewers: { person: { displayName: string }; touches: number }[];
}

/**
 * "You usually also change X."
 *
 * Merge commits are excluded — they restate their parents' files and would
 * inflate every pair they contain.
 */
export async function GET(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const paths = (req.nextUrl.searchParams.get("paths") || "")
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  if (paths.length === 0 || paths.some((p) => !isSafeRepoRelPath(p))) {
    return NextResponse.json({ suggestions: [], commitsAnalysed: 0, domains: [], reviewers: [] } satisfies CouplingPayload);
  }

  const impact = await analyzeChangeImpact(resolved.repoRoot, name, paths);

  return NextResponse.json(
    {
      suggestions: impact.companions,
      commitsAnalysed: impact.commitsAnalysed,
      domains: impact.domains,
      reviewers: impact.reviewers,
    } satisfies CouplingPayload,
    { headers: { "cache-control": "no-store" } },
  );
}
