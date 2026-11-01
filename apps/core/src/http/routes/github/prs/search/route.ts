import { prSearch } from "../../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../../lib/actions/http";
import { isGithubCliAuthenticated, mapGithubCliError } from "../../../../../lib/gh-exec";
import { rowFromSearchItem } from "../../../../../lib/github/prs";
import { githubScreen } from "../../../../../lib/integrations/screen-data";
const searchIssues = githubScreen.search;
import {
  buildPrSearchQuery,
  type PrSearchApiPayload,
  type PrSearchRow,
} from "../../../../../../../../packages/shared/ui-lib/github/pr-search";
import { prStateFrom } from "../../../../../../../../packages/shared/ui-lib/github/search-types";


const MAX_RESULTS = 30;
const ORGS_CACHE_TTL_MS = 30 * 60 * 1000;
const RESULT_CACHE_TTL_MS = 60 * 1000;

let orgsCache: { orgs: string[]; ts: number } | null = null;

async function getUserOrgs(): Promise<string[]> {
  if (orgsCache && Date.now() - orgsCache.ts < ORGS_CACHE_TTL_MS) return orgsCache.orgs;
  try {
    const orgs = await githubScreen.organizations();
    orgsCache = { orgs, ts: Date.now() };
    return orgs;
  } catch {
    return [];
  }
}

const resultCache = new Map<string, { data: PrSearchApiPayload; ts: number }>();

export async function GET(request: Request) {
  return httpAction(prSearch, {
    input: () => ({ query: new URL(request.url).searchParams.get("q") ?? "" }),
    context: () => ({ search: searchPrs }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(request);
}

async function searchPrs(query: string) {
  if (!query) {
    return { status: 200, body: { configured: true, query: "", ghQuery: "", results: [] } };
  }

  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return { status: 200, body: { configured: false, query, ghQuery: "", results: [] } };
  }

  const cached = resultCache.get(query);
  if (cached && Date.now() - cached.ts < RESULT_CACHE_TTL_MS) {
    return { status: 200, body: cached.data };
  }

  try {
    const orgs = await getUserOrgs();
    const ghQuery = buildPrSearchQuery(query, orgs);
    const items = await searchIssues(ghQuery, MAX_RESULTS);

    const results: PrSearchRow[] = items.slice(0, MAX_RESULTS).map((item) => ({
      ...rowFromSearchItem(item),
      prState: prStateFrom({ mergedAt: item.pull_request?.merged_at ?? null, state: item.state }),
    }));

    const payload: PrSearchApiPayload = { configured: true, query, ghQuery, results };
    resultCache.set(query, { data: payload, ts: Date.now() });
    if (resultCache.size > 50) resultCache.delete(resultCache.keys().next().value as string);
    return { status: 200, body: payload };
  } catch (error) {
    console.error("[api:github:prs:search]", error);
    const mapped = mapGithubCliError(error);
    return { status: mapped.status, body: { error: mapped.error } };
  }
}
