import { NextResponse } from "next/server";
import { checkGit } from "@/lib/setup/git-check";
import { clearGitAvailabilityCache } from "@/lib/setup/git-availability";

export const dynamic = "force-dynamic";

/** Is `git` installed where DevHub runs, and what would install it? Read-only. */
export async function GET() {
  clearGitAvailabilityCache();
  return NextResponse.json(checkGit(), { headers: { "Cache-Control": "no-store" } });
}
