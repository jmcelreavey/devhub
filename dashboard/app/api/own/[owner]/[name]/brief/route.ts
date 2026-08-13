import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { recordOwnedRepoVisit, resolveOwnedRepo } from "@/lib/ownership/owned-repos";
import { loadOwnerBrief, OwnedRepoNotFoundError } from "@/lib/ownership/service";

interface Params { params: Promise<{ owner: string; name: string }> }
const VisitSchema = z.object({ headSha: z.string().regex(/^[0-9a-f]{7,64}$/i) });

function fullName(owner: string, name: string): string {
  return `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
}

function notOwned(repo: string): NextResponse {
  return NextResponse.json({ error: `${repo} is not an owned repository`, code: "not-owned" }, { status: 404 });
}

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  const { owner, name } = await params;
  const repo = fullName(owner, name);
  // `core` drops the two slow panels so the page can paint the PR radar and
  // obligations without waiting on a 90-day git log. MCP callers omit it and
  // still get the whole brief in one request.
  const core = req.nextUrl.searchParams.get("panels") === "core";
  try {
    return NextResponse.json(await loadOwnerBrief(repo, {
      includeGaps: !core,
      includeDigest: !core,
    }));
  } catch (error) {
    if (error instanceof OwnedRepoNotFoundError) return notOwned(repo);
    throw error;
  }
}, "own.brief.get");

export const POST = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, VisitSchema);
  if (!parsed.ok) return parsed.response;
  const { owner, name } = await params;
  const repo = fullName(owner, name);
  if (!await resolveOwnedRepo(repo)) return notOwned(repo);
  await recordOwnedRepoVisit(repo, parsed.data.headSha);
  return NextResponse.json({ ok: true });
}, "own.brief.post");
