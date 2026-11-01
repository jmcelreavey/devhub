import { repoDelete, repoDetail } from "../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../lib/actions/http";
import { deleteLocalRepo, readRepoInfo } from "../../../../lib/repos/index";
import { resolveScannedRepo } from "../../../../lib/repos/scanned-repo";

type Params = { params: Promise<{ name: string }> };

/**
 * One repo's card data. The repo hub used to fetch `/api/repos` — a `git status`
 * across every clone — just to pick out the one it shows.
 */
export async function GET(req: Request, { params }: Params) {
  const { name } = await params;
  return httpAction(repoDetail, {
    input: () => ({ name }),
    context: () => ({ read: readRepo }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function readRepo(name: string) {
  const repoPath = resolveScannedRepo(name);
  if (!repoPath) return { status: 404, body: { error: "Repo not found" } };
  try {
    return { status: 200, body: { repo: await readRepoInfo(name, repoPath) } };
  } catch (error) {
    console.error("[api:repos:get]", error);
    return { status: 500, body: { error: "Couldn't read repo" } };
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const { name } = await params;
  return httpAction(repoDelete, {
    input: () => ({ name }),
    context: () => ({ remove: deleteRepo }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function deleteRepo(name: string) {
  try {
    const deleted = deleteLocalRepo(name);
    return { status: 200, body: { ok: true, repo: deleted } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Repo not found") {
      return { status: 404, body: { error: message } };
    }
    if (message.includes("Invalid") || message.includes("Refusing")) {
      return { status: 400, body: { error: message } };
    }
    console.error("[api:repos:delete]", error);
    return { status: 500, body: { error: message } };
  }
}
