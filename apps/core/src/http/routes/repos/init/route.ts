import { repoInit, repoInitInput } from "../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../lib/actions/http";
import { initLocalRepo } from "../../../../lib/repos/index";
import { parseBody } from "../../../../lib/api-utils";

export async function POST(req: Request) {
  const parsed = await parseBody(req, repoInitInput);
  if (!parsed.ok) return parsed.response;
  return httpAction(repoInit, {
    input: () => parsed.data,
    context: () => ({ init: initRepo }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function initRepo(name: string) {
  try {
    const repo = await initLocalRepo(name);
    return { status: 200, body: { ok: true, repo } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already exists")) {
      return { status: 409, body: { error: message } };
    }
    if (message.includes("Invalid")) {
      return { status: 400, body: { error: message } };
    }
    console.error("[api:repos:init]", error);
    return { status: 500, body: { error: message } };
  }
}
