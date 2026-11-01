import { repoLearnPack, type RepoLearnPackResult } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { getGitHead } from "../../../../../../lib/repos/context";
import { buildPackZip, readRepoLearnCache } from "../../../../../../lib/repos/learn-cache";
import { resolveRepoPath } from "../../../../../../lib/repos/learn-resolve";
import { loadRepoLearn } from "../../../../../../lib/repos/learn-service";

type Params = { params: Promise<{ name: string }> };


export async function GET(req: Request, { params }: Params) {
  const { name } = await params;
  return httpAction(repoLearnPack, {
    input: () => ({ name }),
    context: () => ({ load: loadPack }),
    response: (result) => result.ok
      ? new Response(new Uint8Array(result.bytes), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${result.filename}"`,
        },
      })
      : Response.json(result.body, { status: result.status }),
  })(req);
}

async function loadPack(name: string): Promise<RepoLearnPackResult> {
  const repoPath = resolveRepoPath(name);
  if (!repoPath) {
    return { ok: false, body: { error: "Repo not found" }, status: 404 };
  }

  const gitHead = await getGitHead(repoPath);
  let packFiles = readRepoLearnCache(name, gitHead)?.packFiles ?? null;

  if (!packFiles) {
    const loaded = await loadRepoLearn(repoPath, false);
    if (!loaded.artifacts?.packFiles.length) {
      return {
        ok: false,
        body: { error: loaded.message ?? "NotebookLM pack not available. Configure AI_API_KEY and refresh." },
        status: loaded.code === "not_configured" ? 503 : 404,
      };
    }
    packFiles = loaded.artifacts.packFiles;
  }

  return { ok: true, bytes: new Uint8Array(buildPackZip(packFiles)), filename: `${name}-notebooklm-pack.zip` };
}
