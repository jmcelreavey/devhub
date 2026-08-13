import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { recordLearnedDomain, resolveOwnedRepo } from "@/lib/ownership/owned-repos";
import { deriveDomains } from "@/lib/ownership/domains";
import { loadKnowledgeGaps } from "@/lib/ownership/service";

interface Params { params: Promise<{ owner: string; name: string }> }
const BodySchema = z.object({ action: z.literal("learn-opened"), domainId: z.string().min(1).max(120) });

function fullName(owner: string, name: string): string {
  return `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
}

export const GET = withErrorHandler(async (_req: NextRequest, { params }: Params) => {
  const { owner, name } = await params;
  const repo = await resolveOwnedRepo(fullName(owner, name));
  if (!repo) return NextResponse.json({ error: "Owned repo not found" }, { status: 404 });
  const domains = repo.localPath ? await deriveDomains(repo.localPath, repo.domains) : [];
  return NextResponse.json({ gaps: await loadKnowledgeGaps(repo, domains) });
}, "own.gaps.get");

export const POST = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { owner, name } = await params;
  const repo = fullName(owner, name);
  if (!await resolveOwnedRepo(repo)) return NextResponse.json({ error: "Owned repo not found", code: "not-owned" }, { status: 404 });
  await recordLearnedDomain(repo, parsed.data.domainId);
  return NextResponse.json({ ok: true });
}, "own.gaps.post");
