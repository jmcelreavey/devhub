import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { searchDocs } from "@/lib/docs/doc-search";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const params = new URL(req.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ query, results: [] });

  const rawLimit = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;

  return NextResponse.json({ query, results: searchDocs(query, limit) });
}, "docs.search");
