import { NextRequest, NextResponse } from "next/server";
import { cloneGithubRepo } from "@/lib/repos";
import { parseBody } from "@/lib/api-utils";

interface CloneBody {
  fullName?: string;
}

export async function POST(req: NextRequest) {
  const body = await parseBody<CloneBody>(req);
  const fullName = body.fullName?.trim();

  if (!fullName) {
    return NextResponse.json({ error: "GitHub fullName is required" }, { status: 400 });
  }
  try {
    const cloned = await cloneGithubRepo(fullName);
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
