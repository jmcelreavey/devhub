import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { getGitHead, scanRepoContext, type RepoContext } from "@/lib/repo-context";
import { generateRepoLearnArtifacts } from "@/lib/repo-learn-ai";
import {
  readRepoLearnCache,
  writeRepoLearnCache,
  type RepoLearnPackFile,
} from "@/lib/repo-learn-cache";

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

export async function loadRepoLearn(repoPath: string, refresh: boolean): Promise<RepoLearnLoadResult> {
  const context = await scanRepoContext(repoPath);
  const gitHead = await getGitHead(repoPath);
  const aiConfigured = isNotesAiConfigured();

  if (!aiConfigured) {
    return {
      context,
      gitHead,
      aiConfigured: false,
      artifacts: null,
      code: "not_configured",
      message: "Z_AI_API_KEY is not set.",
    };
  }

  if (!refresh) {
    const cached = readRepoLearnCache(context.repoName, gitHead);
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
    const generated = await generateCachedRepoLearnArtifacts(context, gitHead);
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

function generateCachedRepoLearnArtifacts(context: RepoContext, gitHead: string): Promise<RepoLearnArtifactsResponse> {
  const key = `${context.repoName}:${gitHead}`;
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
    });
    return {
      ...generated,
      generatedAt,
      cached: false,
    };
  })();

  inFlightGenerations.set(key, promise);
  void promise.finally(() => inFlightGenerations.delete(key));
  return promise;
}
