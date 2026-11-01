import { cloneGithubRepo, cloneRemoteRepo } from "../../../../lib/repos/index";
import { parseBody } from "../../../../lib/api-utils";
import { RepoCloneSchema } from "../../../../lib/schemas";
import { repoClone, repoCloneRemote, type RepoGitResponse } from "../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../lib/actions/http";

export async function POST(req: Request) {
  const parsed = await parseBody(req, RepoCloneSchema);
  if (!parsed.ok) return parsed.response;

  if ("fullName" in parsed.data) {
    const input = parsed.data;
    return httpAction(repoClone, {
      input: () => input,
      context: () => ({ clone: ({ fullName }) => clone(() => cloneGithubRepo(fullName)) }),
      response: ({ response }) => Response.json(response.body, { status: response.status }),
    })(req);
  }
  const input = parsed.data;
  return httpAction(repoCloneRemote, {
    input: () => input,
    context: () => ({ clone: ({ url, name }) => clone(() => cloneRemoteRepo(url, name)) }),
    response: (response) => Response.json(response.body, { status: response.status }),
  })(req);
}

async function clone(run: () => Promise<unknown>): Promise<RepoGitResponse> {
  try {
    const cloned = await run();
    return { status: 200, body: { ok: true, repo: cloned } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already exists")) {
      return { status: 409, body: { error: message } };
    }
    if (message.includes("Invalid")) {
      return { status: 400, body: { error: message } };
    }
    console.error("[api:repos:clone]", error);
    return { status: 500, body: { error: message } };
  }
}
