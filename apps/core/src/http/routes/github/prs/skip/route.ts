import { prSkip, prSkipInput, prSkippedList, prUnskip } from "../../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../../lib/actions/http";
import { parseBody } from "../../../../../lib/api-utils";
import { listSkippedPrs, skipPr, unskipPr } from "../../../../../lib/github/skipped-prs";
import { dropPrFromGithubPrsCache, invalidateGithubPrsCache } from "../../../../../lib/github/prs";


export async function GET(request: Request) {
  return httpAction(prSkippedList, {
    input: () => ({}),
    context: () => ({ list: listSkippedPrs }),
    response: (skipped) => Response.json({ skipped }),
  })(request);
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, prSkipInput);
  if (!parsed.ok) return parsed.response;
  return httpAction(prSkip, {
    input: () => parsed.data,
    context: () => ({ skip: async (input) => {
      await skipPr(input);
      // Prune the row rather than dumping the cache: a full invalidation makes the
      // next poll re-run two `gh` searches, and skipping several PRs in a row then
      // trips GitHub's secondary rate limit.
      dropPrFromGithubPrsCache(input.url);
    } }),
    response: (result) => Response.json(result),
  })(request);
}

export async function DELETE(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }
  return httpAction(prUnskip, {
    input: () => ({ url }),
    context: () => ({ unskip: async (value) => {
      await unskipPr(value);
      invalidateGithubPrsCache();
    } }),
    response: (result) => Response.json(result),
  })(request);
}
