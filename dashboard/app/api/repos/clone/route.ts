import { NextRequest, NextResponse } from "next/server";
import { cloneGithubRepo, cloneRemoteRepo } from "@/lib/repos";
import { parseBody } from "@/lib/api-utils";
import { RepoCloneSchema } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, RepoCloneSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const cloned =
      "fullName" in parsed.data
        ? await cloneGithubRepo(parsed.data.fullName)
        : await cloneRemoteRepo(parsed.data.url, parsed.data.name);
    return NextResponse.json({ ok: true, repo: cloned });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already exists")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes("Invalid")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[api:repos:clone]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
