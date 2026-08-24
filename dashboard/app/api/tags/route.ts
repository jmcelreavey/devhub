import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { listTags } from "@/lib/tags";

export const dynamic = "force-dynamic";

/**
 * GET /api/tags?q=auth — known tags with usage counts, filtered by substring.
 * Powers the `#` autocomplete in the task composer. Task tags are always
 * fresh; note/doc/event tags come from the recall index.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get("q") ?? undefined;
  return NextResponse.json({ tags: listTags(q).slice(0, 10) });
}, "tags.list");
