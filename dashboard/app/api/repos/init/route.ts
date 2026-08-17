import { NextRequest, NextResponse } from "next/server";
import { initLocalRepo } from "@/lib/repos";
import { parseBody } from "@/lib/api-utils";
import { RepoInitSchema } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, RepoInitSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const repo = await initLocalRepo(parsed.data.name);
    return NextResponse.json({ ok: true, repo });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already exists")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes("Invalid")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[api:repos:init]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
