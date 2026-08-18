import { NextResponse } from "next/server";
import { execGh, isGithubCliAuthenticated, mapGithubCliError } from "@/lib/gh-exec";
import { rowFromSearchItem, searchIssues } from "@/lib/github/prs";
import {
  buildPrSearchQuery,
  type PrSearchApiPayload,
  type PrSearchRow,
} from "@/lib/github/pr-search";
import { prStateFrom } from "@/lib/github/search-types";

export const dynamic = "force-dynamic";

const MAX_RESULTS = 30;
const MAX_QUERY_LENGTH = 200;
const ORGS_CACHE_TTL_MS = 30 * 60 * 1000;
const RESULT_CACHE_TTL_MS = 60 * 1000;

let orgsCache: { orgs: string[]; ts: number } | null = null;

async function getUserOrgs(): Promise<string[]> {
  if (orgsCache && Date.now() - orgsCache.ts < ORGS_CACHE_TTL_MS) return orgsCache.orgs;
  try {
    const { stdout } = await execGh(["api", "/user/orgs?per_page=100"]);
    const parsed = JSON.parse(stdout) as Array<{ login?: string }>;
    const orgs = parsed.map((o) => o.login).filter((l): l is string => !!l);
    orgsCache = { orgs, ts: Date.now() };
    return orgs;
  } catch {
    return [];
  }
}

const resultCache = new Map<string, { data: PrSearchApiPayload; ts: number }>();

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("q") ?? "";
  const query = raw.trim().slice(0, MAX_QUERY_LENGTH);

  if (!query) {
    return NextResponse.json({ configured: true, query: "", ghQuery: "", results: [] });
  }

  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return NextResponse.json({ configured: false, query, ghQuery: "", results: [] });
  }

  const cached = resultCache.get(query);
  if (cached && Date.now() - cached.ts < RESULT_CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
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
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api:github:prs:search]", error);
    const mapped = mapGithubCliError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
