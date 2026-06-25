import { NextResponse } from "next/server";
import path from "node:path";
import { getGitHead } from "@/lib/repo-context";
import { readRepoLearnCache } from "@/lib/repo-learn-cache";
import { resolveRepoPath } from "@/lib/repo-learn-resolve";

type Params = { params: Promise<{ name: string }> };

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: Params) {
  const { name } = await params;
  const repoPath = resolveRepoPath(name);
  if (!repoPath) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const gitHead = await getGitHead(repoPath);
  const cached = readRepoLearnCache(path.basename(repoPath), gitHead);

  return NextResponse.json({
    ok: true,
    ready: !!cached,
    gitHead,
    generatedAt: cached?.generatedAt ?? null,
  });
}
