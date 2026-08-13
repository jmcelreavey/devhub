import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { isSafeRepoRelPath } from "@/lib/git/ref-safety";
import { resolveOwnedRepo } from "@/lib/ownership/owned-repos";
import { loadBlastRadius } from "@/lib/ownership/service";

interface Params { params: Promise<{ owner: string; name: string }> }
// The service truncates to MAX_BLAST_PATHS and reports it, so this bound only
// exists to reject absurd payloads — not to reject large pull requests, which
// used to fail validation and leave the expanded row silently empty.
const BodySchema = z.object({
  paths: z.array(z.string().min(1).max(500).refine(isSafeRepoRelPath, "Unsafe repo path")).min(1).max(2000),
});

export const POST = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { owner, name } = await params;
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const repo = await resolveOwnedRepo(fullName);
  if (!repo) {
    return NextResponse.json({ error: `${fullName} is not an owned repository`, code: "not-owned" }, { status: 404 });
  }
  return NextResponse.json(await loadBlastRadius(repo, parsed.data.paths));
}, "own.blast");
