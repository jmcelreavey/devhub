import { NextRequest, NextResponse } from "next/server";
import { getRepoRoot } from "@/lib/notes-dir";
import { withErrorHandler } from "@/lib/api-utils";
import { listPersonaSources, listPersonaTools, readPersonaBlock } from "@/lib/collect-persona";

export const dynamic = "force-dynamic";

/**
 * Returns the marker-block contents from each tool's config for the requested
 * source(s) so the dashboard can show a diff before pulling them back.
 *
 * Without query params: returns the list of tools + sources.
 * With ?tool=cursor&source=identity: returns the block + repo source content.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const tool = req.nextUrl.searchParams.get("tool");
  const source = req.nextUrl.searchParams.get("source");
  if (!tool && !source) {
    return NextResponse.json({
      tools: listPersonaTools(),
      sources: listPersonaSources(),
    });
  }
  if (!tool || !source) {
    return NextResponse.json(
      { error: "Both `tool` and `source` query params are required." },
      { status: 400 },
    );
  }
  const result = readPersonaBlock(getRepoRoot(), tool, source);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}, "persona.local");
