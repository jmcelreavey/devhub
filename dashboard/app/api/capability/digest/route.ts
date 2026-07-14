import { NextRequest, NextResponse } from "next/server";
import { listDigests, readLatestDigest, runDigest } from "@/lib/capability/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export function GET() {
  return NextResponse.json({ latest: readLatestDigest(), digests: listDigests() });
}

export async function POST(req: NextRequest) {
  let body: { includeGithub?: boolean; githubFilter?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // empty body is fine — defaults to a local-only digest
  }
  try {
    const digest = await runDigest({
      includeGithub: body.includeGithub === true,
      githubFilter: body.githubFilter?.trim() || undefined,
    });
    return NextResponse.json(digest);
  } catch (err) {
    console.error("[api:capability:digest]", err);
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
