import { recallQueryInput, recallQuery } from "../../../../../../packages/shared/actions/recall";
import { withErrorHandler } from "../../../lib/api-utils";
import { formatRecallMarkdown, recall } from "../../../lib/recall/recall";
import { gradeRecall } from "../../../lib/recall/grade";
import { RECALL_SOURCE_KINDS, type RecallSourceKind } from "../../../../../../packages/shared/ui-lib/recall/types";


const QuerySchema = recallQueryInput;

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
export const GET = withErrorHandler(async (req: Request) => {
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }

  return await recallQuery.handler(parsed.data, { execute: async () => {
    const { q, limit, budget, alpha, since, format } = parsed.data;
    const result = recall({
      query: q,
      limit,
      budgetTokens: budget,
      alpha,
      since,
      kinds: parseKinds(new URL(req.url).searchParams.get("kinds")),
    });

    // The grade rides alongside rather than filtering: ranking returns the best
    // available chunks, and whether "best available" is "good enough" is a
    // separate claim the caller should be able to see and act on.
    const grade = gradeRecall(result);

    if (format === "markdown") {
      return Response.json({ markdown: formatRecallMarkdown(result, grade), result, grade });
    }
    return Response.json({ ...result, grade });
  } }) as Response;
}, "recall");
