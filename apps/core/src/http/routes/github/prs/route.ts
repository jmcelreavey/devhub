import { prList, prListDetails, type PrOpenResponse } from "../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../lib/actions/http";
import { loadGithubPrsList } from "../../../../lib/github/prs-list";
import { mapGithubCliError } from "../../../../lib/gh-exec";
import { withErrorHandler } from "../../../../lib/api-utils";


export const GET = withErrorHandler<[request: Request]>(async (request) => {
  const context = { list: readPrs };
  const response = (result: PrOpenResponse) => Response.json(result.body, { status: result.status });
  if (new URL(request.url).searchParams.get("details") === "1") {
    return httpAction(prListDetails, { input: () => ({ details: true }), context: () => context, response })(request);
  }
  return httpAction(prList, { input: () => ({}), context: () => context, response })(request);
}, "github.prs.get");

async function readPrs(details: boolean) {
  try {
    return { status: 200, body: await loadGithubPrsList(details) };
  } catch (error) {
    console.error("[api:github:prs]", error);
    const mapped = mapGithubCliError(error);
    return { status: mapped.status, body: { error: mapped.error } };
  }
}
