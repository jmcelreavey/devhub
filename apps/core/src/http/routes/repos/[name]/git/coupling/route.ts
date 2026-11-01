import { repoGitCoupling } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import type { CouplingSuggestion } from "../../../../../../lib/git/change-coupling";
import { analyzeChangeImpact } from "../../../../../../lib/repos/change-impact";
import { isSafeRepoRelPath } from "../../../../../../lib/git/ref-safety";
import { withScannedRepo, type RepoParams } from "../_shared";


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
export async function GET(req: Request, { params }: RepoParams) {
  const { name } = await params;
  return httpAction(repoGitCoupling, {
    input: () => ({ name, paths: new URL(req.url).searchParams.get("paths") || "" }),
    context: () => ({ read: async (repo, paths) => {
      const response = await readCoupling(repo, paths);
      return { status: response.status, body: await response.json(), headers: Object.fromEntries(response.headers) };
    } }),
    response: (result) => Response.json(result.body, { status: result.status, headers: result.headers }),
  })(req);
}

async function readCoupling(name: string, requestedPaths: string) {
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const paths = requestedPaths
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  if (paths.length === 0 || paths.some((p) => !isSafeRepoRelPath(p))) {
    return Response.json({ suggestions: [], commitsAnalysed: 0, domains: [], reviewers: [] } satisfies CouplingPayload);
  }

  const impact = await analyzeChangeImpact(resolved.repoRoot, name, paths);

  return Response.json(
    {
      suggestions: impact.companions,
      commitsAnalysed: impact.commitsAnalysed,
      domains: impact.domains,
      reviewers: impact.reviewers,
    } satisfies CouplingPayload,
    { headers: { "cache-control": "no-store" } },
  );
}
