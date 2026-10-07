/**
 * One JSON file per repo under `<notes>/.config/conventions/`.
 *
 * Under `.config` on purpose: every vault walker skips dot-directories, so these
 * files stay out of the notes tree and out of Recall's note corpus (Recall reads
 * them through its own reader), yet they are committed with the rest of the
 * vault and diffable — a rule's whole history is `git log` away.
 */
import path from "node:path";
import fs from "node:fs";
import { safeReadJSON, withMutex, writeAtomic } from "@/lib/atomic-write";
import { getNotesDir } from "@/lib/notes/dir";
import type { ConventionsFile } from "./types";

const MAX_RUNS = 10;

export function conventionsDir(): string {
  return path.join(getNotesDir(), ".config", "conventions");
}

/** GitHub names are case-insensitive, so the file key is too. */
export function repoFileKey(repo: string): string {
  return repo.trim().toLowerCase().replace("/", "__");
}

export function conventionsFilePath(repo: string): string {
  return path.join(conventionsDir(), `${repoFileKey(repo)}.json`);
}

export function emptyConventions(repo: string): ConventionsFile {
  return { version: 1, repo, rules: [], minedPrs: {}, runs: [] };
}

function coerce(raw: ConventionsFile | null, repo: string): ConventionsFile | null {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.rules)) return null;
  return {
    ...raw,
    repo: raw.repo || repo,
    minedPrs: raw.minedPrs && typeof raw.minedPrs === "object" ? raw.minedPrs : {},
    runs: Array.isArray(raw.runs) ? raw.runs : [],
  };
}

export function readConventions(repo: string): ConventionsFile | null {
  return coerce(safeReadJSON<ConventionsFile | null>(conventionsFilePath(repo), null), repo);
}

export function listConventions(): ConventionsFile[] {
  const dir = conventionsDir();
  if (!fs.existsSync(dir)) return [];
  const out: ConventionsFile[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const repo = name.replace(/\.json$/, "").replace("__", "/");
    const file = coerce(safeReadJSON<ConventionsFile | null>(path.join(dir, name), null), repo);
    if (file) out.push(file);
  }
  return out.sort((a, b) => a.repo.localeCompare(b.repo));
}

/**
 * Read-modify-write under the file mutex. The miner holds a model call open for
 * a minute or two, and a person can accept or reject rules in that window —
 * merging into whatever is on disk *now* keeps their decisions.
 *
 * `mutate` may edit in place or return a replacement.
 */
export async function updateConventions(
  repo: string,
  mutate: (file: ConventionsFile) => ConventionsFile | void,
): Promise<ConventionsFile> {
  const target = conventionsFilePath(repo);
  return withMutex(target, async () => {
    const current = readConventions(repo) ?? emptyConventions(repo);
    const next = mutate(current) ?? current;
    next.runs = next.runs.slice(0, MAX_RUNS);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await writeAtomic(target, JSON.stringify(next, null, 2));
    return next;
  });
}
