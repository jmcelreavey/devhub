import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { fetchPrState, PR_REPO_RE } from "@/lib/github/pr-state";

export const dynamic = "force-dynamic";

/** `?repo=owner/name&number=N` → live checks, reviews and merge state (MCP `events_wait`). */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const repo = req.nextUrl.searchParams.get("repo") ?? "";
  const number = Number(req.nextUrl.searchParams.get("number"));
  if (!PR_REPO_RE.test(repo) || !Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ error: "repo (owner/name) and a positive PR number are required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ pr: await fetchPrState(repo, number) });
  } catch (err) {
    // execExternal's message is just "Command failed: <argv>"; gh says why on stderr.
    const stderr = (err as { stderr?: unknown }).stderr;
    const reason =
      (typeof stderr === "string" && stderr.trim()) || (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: `gh pr view failed: ${reason.split("\n")[0]}` }, { status: 502 });
  }
}, "github.pr-state");
