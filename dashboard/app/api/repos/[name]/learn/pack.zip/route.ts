import { NextResponse } from "next/server";
import { getGitHead } from "@/lib/repo-context";
import { buildPackZip, readRepoLearnCache } from "@/lib/repo-learn-cache";
import { resolveRepoPath } from "@/lib/repo-learn-resolve";
import { loadRepoLearn } from "@/lib/repo-learn-service";

type Params = { params: Promise<{ name: string }> };

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: Params) {
  const { name } = await params;
  const repoPath = resolveRepoPath(name);
  if (!repoPath) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const gitHead = await getGitHead(repoPath);
  let packFiles = readRepoLearnCache(name, gitHead)?.packFiles ?? null;

  if (!packFiles) {
    const loaded = await loadRepoLearn(repoPath, false);
    if (!loaded.artifacts?.packFiles.length) {
      return NextResponse.json(
        { error: loaded.message ?? "NotebookLM pack not available. Configure AI_API_KEY and refresh." },
        { status: loaded.code === "not_configured" ? 503 : 404 },
      );
    }
    packFiles = loaded.artifacts.packFiles;
  }

  const zip = buildPackZip(packFiles);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}-notebooklm-pack.zip"`,
    },
  });
}
