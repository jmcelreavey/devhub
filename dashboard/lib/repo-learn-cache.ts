import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { getRepoRoot } from "@/lib/notes-dir";
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
}

function cacheFile(repoName: string): string {
  return path.join(getRepoRoot(), "notes", ".cache", "repo-learn", `${repoName}.json`);
}

export function readRepoLearnCache(repoName: string, gitHead: string): RepoLearnCache | null {
  const cached = safeReadJSON<RepoLearnCache | null>(cacheFile(repoName), null);
  if (!cached || cached.gitHead !== gitHead) return null;
  return cached;
}

export async function writeRepoLearnCache(entry: RepoLearnCache): Promise<void> {
  const file = cacheFile(entry.repoName);
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
