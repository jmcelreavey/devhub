import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { deriveDomains } from "@/lib/ownership/domains";
import { resolveOwnedRepo } from "@/lib/ownership/owned-repos";
import { loadRepoDigest } from "@/lib/ownership/service";
import { catchUpSince } from "@/lib/catch-up";

interface Params { params: Promise<{ owner: string; name: string }> }
const ShaSchema = z.string().regex(/^[0-9a-f]{7,64}$/i);
const BodySchema = z.object({
  sinceSha: ShaSchema.nullable().optional(),
  headSha: ShaSchema.optional(),
});

async function repoAndDomains(params: Params["params"]) {
  const { owner, name } = await params;
  const repo = await resolveOwnedRepo(`${decodeURIComponent(owner)}/${decodeURIComponent(name)}`);
  if (!repo) return null;
  return { repo, domains: repo.localPath ? await deriveDomains(repo.localPath, repo.domains) : [] };
}

export const GET = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  const resolved = await repoAndDomains(params);
  if (!resolved) return NextResponse.json({ error: "Owned repo not found", code: "not-owned" }, { status: 404 });
  const since = req.nextUrl.searchParams.get("since");
  // `since=recent` ignores the watermark and shows the tail of history. Without
  // it, an owner who has caught up has no way back to what they just read.
  const explicit = since && /^[0-9a-f]{7,64}$/i.test(since) ? since : resolved.repo.lastSeenSha;
  const sinceSha = catchUpSince(since === "recent" ? "recent" : "watermark", explicit);
  return NextResponse.json(await loadRepoDigest(resolved.repo, resolved.domains, { sinceSha }));
}, "own.digest.get");

export const POST = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const resolved = await repoAndDomains(params);
  if (!resolved) return NextResponse.json({ error: "Owned repo not found" }, { status: 404 });
  return NextResponse.json(await loadRepoDigest(resolved.repo, resolved.domains, {
    ...parsed.data,
    generate: true,
  }));
}, "own.digest.post");
