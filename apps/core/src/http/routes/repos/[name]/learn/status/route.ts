import path from "node:path";
import { repoLearnStatus } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { getGitHead } from "../../../../../../lib/repos/context";
import { readRepoLearnCache } from "../../../../../../lib/repos/learn-cache";
import { resolveRepoPath } from "../../../../../../lib/repos/learn-resolve";

type Params = { params: Promise<{ name: string }> };


export async function GET(req: Request, { params }: Params) {
  const { name } = await params;
  return httpAction(repoLearnStatus, {
    input: () => ({ name }),
    context: () => ({ read: async (repo) => {
      const response = await readStatus(repo);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function readStatus(name: string) {
  const repoPath = resolveRepoPath(name);
  if (!repoPath) {
    return Response.json({ error: "Repo not found" }, { status: 404 });
  }

  const gitHead = await getGitHead(repoPath);
  const cached = readRepoLearnCache(path.basename(repoPath), gitHead);

  return Response.json({
    ok: true,
    ready: !!cached,
    gitHead,
    generatedAt: cached?.generatedAt ?? null,
  });
}
