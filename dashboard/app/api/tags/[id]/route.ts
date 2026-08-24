import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { lookupTag, TAG_TOKEN_RE } from "@/lib/tags";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/**
 * GET /api/tags/[id] — everything tied to one tag: live task matches, notes
 * and docs from the recall index, and the derived graph's PR/Jira neighbours.
 * Powers the work-page tag context card.
 */
export const GET = withErrorHandler(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  if (!TAG_TOKEN_RE.test(id)) {
    return NextResponse.json({ error: "Invalid tag" }, { status: 400 });
  }
  return NextResponse.json(lookupTag(id));
}, "tags.lookup");
