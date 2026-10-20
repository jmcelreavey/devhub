import { NextResponse } from "next/server";
import { loadGithubPrsList } from "@/lib/github/prs-list";
import { mapGithubCliError } from "@/lib/gh-exec";
import { withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler<[request?: Request]>(async () => {
  try {
    return NextResponse.json(await loadGithubPrsList());
  } catch (error) {
    console.error("[api:github:prs]", error);
    const mapped = mapGithubCliError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}, "github.prs.get");
