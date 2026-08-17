import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandler } from "@/lib/api-utils";
import { formatRecallMarkdown, recall } from "@/lib/recall/recall";
import { gradeRecall } from "@/lib/recall/grade";
import { RECALL_SOURCE_KINDS, type RecallSourceKind } from "@/lib/recall/types";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  q: z.string().min(1, "query is required"),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  budget: z.coerce.number().int().min(100).max(32_000).optional(),
  alpha: z.coerce.number().min(0).max(1).optional(),
  since: z.coerce.number().int().optional(),
  format: z.enum(["json", "markdown"]).optional(),
});

function parseKinds(raw: string | null): RecallSourceKind[] | undefined {
  if (!raw) return undefined;
  const wanted = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is RecallSourceKind =>
      (RECALL_SOURCE_KINDS as readonly string[]).includes(part),
    );
  return wanted.length > 0 ? wanted : undefined;
}

/**
 * GET /api/recall?q=…&budget=2000&alpha=0.5&kinds=note,learning&format=markdown
 *
 * Read-only, so no auth guard beyond the global same-origin check in
 * `proxy.ts`. `format=markdown` returns the same payload plus a pre-rendered
 * block, which is what the MCP tool forwards to an agent — rendering it here
 * rather than in the MCP server keeps one formatter for both consumers.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }

  const { q, limit, budget, alpha, since, format } = parsed.data;
  const result = recall({
    query: q,
    limit,
    budgetTokens: budget,
    alpha,
    since,
    kinds: parseKinds(req.nextUrl.searchParams.get("kinds")),
  });

  // The grade rides alongside rather than filtering: ranking returns the best
  // available chunks, and whether "best available" is "good enough" is a
  // separate claim the caller should be able to see and act on.
  const grade = gradeRecall(result);

  if (format === "markdown") {
    return NextResponse.json({ markdown: formatRecallMarkdown(result, grade), result, grade });
  }
  return NextResponse.json({ ...result, grade });
}, "recall");
