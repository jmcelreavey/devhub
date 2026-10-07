import { NextResponse } from "next/server";
import { checkGit } from "@/lib/setup/git-check";

export const dynamic = "force-dynamic";

/** Is `git` installed where DevHub runs, and what would install it? Read-only. */
export async function GET() {
  return NextResponse.json(checkGit(), { headers: { "Cache-Control": "no-store" } });
}
