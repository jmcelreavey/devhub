import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { ingestGit } from "@/lib/recall/ingest";
import { listRepos } from "@/lib/repos";
import { buildIndex } from "@/lib/recall/store";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  /** Also scan every repo under the configured repos directory. */
  allRepos: z.boolean().optional(),
  /** Commits per repo. */
  limit: z.number().int().min(1).max(2000).optional(),
  /** Git `--since`, e.g. `6.months`. */
  since: z.string().max(40).optional(),
  /** Rebuild the index afterwards so new events are immediately queryable. */
  reindex: z.boolean().optional(),
});

/**
 * POST /api/recall/ingest — pull commits into the event spine.
 *
 * Idempotent by construction (see `eventId` in lib/recall/ingest), so this is
 * safe to run from a schedule or a post-commit hook. Repo discovery lives here
 * rather than in the ingest module because it needs the desktop runtime paths.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, BodySchema.optional().default({}));
  if (!parsed.ok) return parsed.response;
  const { allRepos, limit, since, reindex = true } = parsed.data;

  let repos: string[] = [];
  if (allRepos) {
    try {
      repos = (await listRepos()).map((repo) => repo.path);
    } catch {
      // No repos directory configured is a normal state, not an error — the
      // DevHub checkout itself is always ingested regardless.
      repos = [];
    }
  }

  const results = await ingestGit({ repos, limit, since });
  const written = results.reduce((sum, r) => sum + r.written, 0);
  const manifest = reindex && written > 0 ? buildIndex() : null;

  return NextResponse.json({ ok: true, results, written, manifest });
}, "recall.ingest");
