import { repoGithubList } from "../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../lib/actions/http";
import { mapGithubCliError } from "../../../../lib/gh-exec";
import { listGithubRepos } from "../../../../lib/repos/index";


export async function GET(req: Request) {
  const query = new URL(req.url).searchParams.get("q") ?? undefined;
  return httpAction(repoGithubList, {
    input: () => ({ query }),
    context: () => ({ list: listRepos }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function listRepos(query?: string) {
  try {
    const repos = await listGithubRepos(query);
    return { status: 200, body: { repos } };
  } catch (error) {
    console.error("[api:repos:github]", error);
    const mapped = mapGithubCliError(error);
    return { status: mapped.status, body: { error: mapped.error } };
  }
}
