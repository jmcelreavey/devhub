import { NextResponse } from "next/server";
import type { RepoContext } from "@/lib/repos/context";
import { loadRepoLearn } from "@/lib/repos/learn-service";
import { resolveRepoPath } from "@/lib/repos/learn-resolve";
import type { RepoContextPayload, RepoLearnApiPayload } from "@/app/repos/types";
import { deriveDomains } from "@/lib/repos/domains";
import { resolveOwnedRepo, resolveOwnedRepos } from "@/lib/ownership/owned-repos";
import { loadKnowledgeGaps } from "@/lib/ownership/service";

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
  const domainId = new URL(req.url).searchParams.get("domain")?.trim();
  const ownedFullName = new URL(req.url).searchParams.get("owned")?.trim();
  if (ownedFullName && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ownedFullName)) {
    return NextResponse.json({ error: "Invalid owned repository; expected owner/name" }, { status: 400 });
  }
  const hintedOwnedRepo = ownedFullName
    ? await resolveOwnedRepo(ownedFullName)
    : (await resolveOwnedRepos()).find((candidate) => candidate.localPath === repoPath) ?? null;
  const ownedRepo = hintedOwnedRepo?.localPath === repoPath ? hintedOwnedRepo : null;
  const overrides = ownedRepo?.localPath === repoPath ? ownedRepo.domains : null;
  const domains = domainId ? await deriveDomains(repoPath, overrides) : [];
  const domain = domains.find((candidate) => candidate.id === domainId);

  try {
    const result = await loadRepoLearn(
      repoPath,
      refresh,
      domain ? { id: domain.id, label: domain.label, paths: domain.paths } : undefined,
    );
    const overview = result.artifacts?.packFiles.find((f) => f.path === "00-overview.md");

    const ownershipDomains = ownedRepo ? await deriveDomains(repoPath, ownedRepo.domains) : [];
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
      ownership: ownedRepo ? {
        fullName: ownedRepo.fullName,
        domains: ownershipDomains,
        gaps: await loadKnowledgeGaps(ownedRepo, ownershipDomains),
      } : undefined,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api:repos:learn]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
