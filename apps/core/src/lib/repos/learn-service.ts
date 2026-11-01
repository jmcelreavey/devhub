import { createHash } from "node:crypto";
import { resolveAiProvider } from "../ai/preference";

import { getGitHead, scanRepoContext, type RepoContext } from "./context";
import { generateRepoLearnArtifacts } from "./learn-ai";
import {
  readRepoLearnCache,
  writeRepoLearnCache,
  type RepoLearnPackFile,
} from "./learn-cache";

const inFlightGenerations = new Map<string, Promise<RepoLearnArtifactsResponse>>();

export interface RepoLearnArtifactsResponse {
  briefMarkdown: string;
  packFiles: RepoLearnPackFile[];
  generatedAt: string;
  cached: boolean;
}

export interface RepoLearnLoadResult {
  context: RepoContext;
  gitHead: string;
  aiConfigured: boolean;
  artifacts: RepoLearnArtifactsResponse | null;
  code?: "not_configured" | "error";
  message?: string;
}

export async function loadRepoLearn(
  repoPath: string,
  refresh: boolean,
  scope?: { id: string; label: string; paths: string[] },
): Promise<RepoLearnLoadResult> {
  const context = await scanRepoContext(repoPath, scope);
  const gitHead = await getGitHead(repoPath);
  const scopeKey = scope
    ? `${scope.id}-${createHash("sha1").update(scope.paths.join("\n")).digest("hex").slice(0, 8)}`
    : undefined;
  const resolved = await resolveAiProvider();
  const aiConfigured = resolved.provider !== null;

  if (!aiConfigured) {
    return {
      context,
      gitHead,
      aiConfigured: false,
      artifacts: null,
      code: "not_configured",
      message: resolved.setupHint ?? "No AI provider available.",
    };
  }


  if (!refresh) {
    const cached = readRepoLearnCache(context.repoName, gitHead, scopeKey);
    if (cached) {
      return {
        context,
        gitHead,
        aiConfigured: true,
        artifacts: {
          briefMarkdown: cached.briefMarkdown,
          packFiles: cached.packFiles,
          generatedAt: cached.generatedAt,
          cached: true,
        },
      };
    }
  }

  try {
    const generated = await generateCachedRepoLearnArtifacts(context, gitHead, scopeKey);
    return {
      context,
      gitHead,
      aiConfigured: true,
      artifacts: generated,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      context,
      gitHead,
      aiConfigured: true,
      artifacts: null,
      code: "error",
      message,
    };
  }
}

function generateCachedRepoLearnArtifacts(
  context: RepoContext,
  gitHead: string,
  scopeKey?: string,
): Promise<RepoLearnArtifactsResponse> {
  const key = `${context.repoName}:${gitHead}:${scopeKey ?? "all"}`;
  const existing = inFlightGenerations.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const generated = await generateRepoLearnArtifacts(context);
    const generatedAt = new Date().toISOString();
    await writeRepoLearnCache({
      repoName: context.repoName,
      gitHead,
      generatedAt,
      briefMarkdown: generated.briefMarkdown,
      packFiles: generated.packFiles,
      scopeKey,
    });
    return {
      ...generated,
      generatedAt,
      cached: false,
    };
  })().finally(() => inFlightGenerations.delete(key));

  inFlightGenerations.set(key, promise);
  return promise;
}
