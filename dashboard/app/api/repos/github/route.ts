import { NextRequest, NextResponse } from "next/server";
import { mapGithubCliError } from "@/lib/gh-exec";
import { listGithubRepos } from "@/lib/repos";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") ?? undefined;

  try {
    const repos = await listGithubRepos(query);
    return NextResponse.json({ repos });
  } catch (error) {
    console.error("[api:repos:github]", error);
    const mapped = mapGithubCliError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
