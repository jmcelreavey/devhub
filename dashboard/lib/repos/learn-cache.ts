import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { getNotesDir } from "@/lib/notes/dir";
import { safeReadJSON, writeAtomic } from "@/lib/atomic-write";

export interface RepoLearnPackFile {
  path: string;
  content: string;
}

export interface RepoLearnCache {
  repoName: string;
  gitHead: string;
  generatedAt: string;
  briefMarkdown: string;
  packFiles: RepoLearnPackFile[];
  scopeKey?: string;
}

function cacheFile(repoName: string, scopeKey?: string): string {
  const suffix = scopeKey ? `--${scopeKey.replace(/[^a-z0-9_-]+/gi, "-")}` : "";
  return path.join(getNotesDir(), ".cache", "repo-learn", `${repoName}${suffix}.json`);
}

export function readRepoLearnCache(repoName: string, gitHead: string, scopeKey?: string): RepoLearnCache | null {
  const cached = safeReadJSON<RepoLearnCache | null>(cacheFile(repoName, scopeKey), null);
  if (!cached || cached.gitHead !== gitHead || cached.scopeKey !== scopeKey) return null;
  return cached;
}

export async function writeRepoLearnCache(entry: RepoLearnCache): Promise<void> {
  const file = cacheFile(entry.repoName, entry.scopeKey);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await writeAtomic(file, JSON.stringify(entry));
}

export function buildPackZip(packFiles: RepoLearnPackFile[]): Buffer {
  const zip = new AdmZip();
  for (const file of packFiles) {
    zip.addFile(file.path, Buffer.from(file.content, "utf8"));
  }
  return zip.toBuffer();
}
