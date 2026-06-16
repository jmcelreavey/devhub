import { NextResponse } from "next/server";
import type { RepoContext } from "@/lib/repo-context";
import { loadRepoLearn } from "@/lib/repo-learn-service";
import { resolveRepoPath } from "@/lib/repo-learn-resolve";
import type { RepoContextPayload, RepoLearnApiPayload } from "@/app/repos/types";

type Params = { params: Promise<{ name: string }> };

function toContextPayload(context: RepoContext): RepoContextPayload {
  const {
    snippets: _omit,
    ...rest
  } = context;
  void _omit;
  return rest;
}

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: Params) {
  const { name } = await params;
  const repoPath = resolveRepoPath(name);
  if (!repoPath) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  try {
    const result = await loadRepoLearn(repoPath, refresh);
    const overview = result.artifacts?.packFiles.find((f) => f.path === "00-overview.md");

    const payload: RepoLearnApiPayload = {
      ok: result.code !== "error",
      context: toContextPayload(result.context),
      gitHead: result.gitHead,
      aiConfigured: result.aiConfigured,
      artifacts: result.artifacts
        ? {
            briefMarkdown: result.artifacts.briefMarkdown,
            packFiles: result.artifacts.packFiles.map((f) => ({
              path: f.path,
              sizeBytes: Buffer.byteLength(f.content, "utf8"),
            })),
            overviewMarkdown: overview?.content ?? null,
            generatedAt: result.artifacts.generatedAt,
            cached: result.artifacts.cached,
          }
        : null,
      code: result.code,
      message: result.message,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api:repos:learn]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
