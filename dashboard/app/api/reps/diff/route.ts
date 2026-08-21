import { NextResponse, type NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { execGh, isGithubCliAuthenticated, mapGithubCliError } from "@/lib/gh-exec";

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const GET = withErrorHandler(async (req: NextRequest) => {
  const repo = req.nextUrl.searchParams.get("repo") ?? "";
  const number = Number(req.nextUrl.searchParams.get("number"));
  if (!REPO_RE.test(repo) || !Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ error: "repo (owner/name) and number are required" }, { status: 400 });
  }
  if (!(await isGithubCliAuthenticated())) {
    return NextResponse.json({ error: "GitHub CLI is not authenticated." }, { status: 503 });
  }
  try {
    const { stdout } = await execGh(["pr", "diff", String(number), "--repo", repo]);
    return NextResponse.json({ diff: stdout });
  } catch (error) {
    const mapped = mapGithubCliError(error, "Could not load PR diff");
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}, "reps.diff");
