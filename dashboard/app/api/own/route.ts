import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { addOwnedRepo, removeOwnedRepo, resolveOwnedRepos } from "@/lib/ownership/owned-repos";
import { invalidateOwnershipSummary, loadOwnershipSummary } from "@/lib/ownership/service";

const RepoSchema = z.object({
  fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Expected owner/name"),
});

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const repos = await resolveOwnedRepos();
  if (req.nextUrl.searchParams.get("summary") !== "1") return NextResponse.json({ repos });
  // Obligation-level only. Gaps and catch-up history are per-repo panels and are
  // far too expensive to compute once per owned repo just to render the index.
  return NextResponse.json({ repos, summaries: await loadOwnershipSummary() });
}, "own.get");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, RepoSchema);
  if (!parsed.ok) return parsed.response;
  const repo = await addOwnedRepo(parsed.data.fullName);
  invalidateOwnershipSummary();
  return NextResponse.json({ ok: true, repo }, { status: 201 });
}, "own.post");

export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, RepoSchema);
  if (!parsed.ok) return parsed.response;
  await removeOwnedRepo(parsed.data.fullName);
  invalidateOwnershipSummary();
  return NextResponse.json({ ok: true });
}, "own.delete");
