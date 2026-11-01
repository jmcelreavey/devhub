import { withErrorHandler } from "../../../../lib/api-utils";
import { searchDocs } from "../../../../lib/docs/doc-search";
import { docsPageSearch } from "../../../../../../../packages/shared/actions/docs";

export const GET = withErrorHandler(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const rawLimit = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;

  const input = docsPageSearch.input.parse({ query, limit });
  return Response.json(await docsPageSearch.handler(input, { search: searchDocs }));
}, "docs.search");
