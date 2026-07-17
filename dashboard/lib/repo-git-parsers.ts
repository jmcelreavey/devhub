/**
 * Parsers for scanned-repo git porcelain / log / stash / blame output.
 * Kept pure for unit tests — no filesystem.
 */

export interface StagedFileInfo {
  path: string;
  /** Index (staged) status letter, or empty if unstaged-only. */
  indexStatus: string;
  /** Worktree status letter, or empty if staged-only / clean worktree. */
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface StashEntry {
  ref: string;
  index: number;
  branch: string | null;
  message: string;
  /** Raw stash list line after `stash@{n}:`. */
  detail: string;
}

export interface GraphCommitRaw {
  hash: string;
  shortHash: string;
  parents: string[];
  subject: string;
  author: string;
  relativeDate: string;
  refs: string[];
}

export interface BlameLine {
  hash: string;
  author: string;
  date: string;
  lineNumber: number;
  content: string;
}

export interface FileHistoryCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  relativeDate: string;
}

/** Parse `git status --porcelain=v1` into staged / unstaged / untracked rows. */
export function parsePorcelainStatus(stdout: string): StagedFileInfo[] {
  const rows: StagedFileInfo[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim() || line.length < 3) continue;
    const indexStatus = line[0] === " " ? "" : line[0]!;
    const worktreeStatus = line[1] === " " ? "" : line[1]!;
    let filePath = line.slice(3);
    // Rename: `R  old -> new` — show the new path.
    if (filePath.includes(" -> ")) {
      filePath = filePath.split(" -> ").pop()!.trim();
    }
    const untracked = indexStatus === "?" && worktreeStatus === "?";
    const staged = !untracked && indexStatus !== "";
    const unstaged = untracked || worktreeStatus !== "";
    rows.push({
      path: filePath,
      indexStatus: untracked ? "?" : indexStatus,
      worktreeStatus: untracked ? "?" : worktreeStatus,
      staged,
      unstaged,
      untracked,
    });
  }
  return rows;
}

/** Display status glyph for a file row (prefer worktree, then index). */
export function fileStatusGlyph(file: StagedFileInfo): string {
  if (file.untracked) return "??";
  if (file.indexStatus && file.worktreeStatus) return `${file.indexStatus}${file.worktreeStatus}`;
  return file.indexStatus || file.worktreeStatus || "M";
}

/** macOS / Python clutter that rarely belongs in a staging UI. */
export function isGitNoisePath(filePath: string): boolean {
  const parts = filePath.split(/[/\\]/);
  const base = parts[parts.length - 1] ?? filePath;
  return base === ".DS_Store" || base.endsWith(".pyc") || parts.includes("__pycache__");
}

/** Dirty paths that should drive badges / "N changed" (excludes system junk). */
export function countVisibleDirtyFromPorcelain(stdout: string): number {
  return parsePorcelainStatus(stdout).filter((f) => !isGitNoisePath(f.path)).length;
}

/**
 * Parse `git stash list --format=%gd%x00%gs`.
 * Typical message: `WIP on main: abc1234 subject` or `On main: named stash`.
 */
export function parseStashList(stdout: string): StashEntry[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      const [refRaw = "", detail = ""] = line.split("\0");
      const ref = refRaw.trim() || `stash@{${i}}`;
      const indexMatch = ref.match(/stash@\{(\d+)\}/);
      const index = indexMatch ? Number(indexMatch[1]) : i;
      const onMatch = detail.match(/^(?:WIP on|On) ([^:]+):\s*(.*)$/);
      return {
        ref,
        index,
        branch: onMatch?.[1] ?? null,
        message: (onMatch?.[2] ?? detail).trim() || detail.trim() || ref,
        detail: detail.trim(),
      };
    });
}

/**
 * Parse graph log:
 * `%x1e%H%x00%P%x00%h%x00%s%x00%an%x00%ar%x00%D`
 */
export function parseGraphLog(stdout: string): GraphCommitRaw[] {
  return stdout
    .split("\u001e")
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [hash = "", parentsRaw = "", shortHash = "", subject = "", author = "", relativeDate = "", refsRaw = ""] =
        chunk.trim().split("\0");
      const parents = parentsRaw.trim() ? parentsRaw.trim().split(/\s+/) : [];
      const refs = refsRaw
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => r.replace(/^HEAD -> /, "").replace(/^tag: /, "tag:"));
      return { hash, shortHash, parents, subject, author, relativeDate, refs };
    });
}

/**
 * Parse `git blame --line-porcelain` into display lines.
 */
export function parseBlamePorcelain(stdout: string): BlameLine[] {
  const lines: BlameLine[] = [];
  let hash = "";
  let author = "";
  let date = "";
  let lineNumber = 0;

  for (const raw of stdout.split("\n")) {
    if (/^[0-9a-f]{40}\s/.test(raw)) {
      const parts = raw.split(/\s+/);
      hash = parts[0] ?? "";
      lineNumber = Number(parts[2] ?? 0);
      continue;
    }
    if (raw.startsWith("author ")) {
      author = raw.slice("author ".length);
      continue;
    }
    if (raw.startsWith("author-time ")) {
      const ts = Number(raw.slice("author-time ".length));
      date = Number.isFinite(ts) ? new Date(ts * 1000).toISOString().slice(0, 10) : "";
      continue;
    }
    if (raw.startsWith("\t")) {
      lines.push({
        hash: hash.slice(0, 7),
        author,
        date,
        lineNumber,
        content: raw.slice(1),
      });
    }
  }
  return lines;
}

/**
 * Parse file history: `%x1e%H%x00%h%x00%s%x00%an%x00%ar`
 */
export function parseFileHistory(stdout: string): FileHistoryCommit[] {
  return stdout
    .split("\u001e")
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [hash = "", shortHash = "", subject = "", author = "", relativeDate = ""] = chunk.trim().split("\0");
      return { hash, shortHash, subject, author, relativeDate };
    });
}

/** Split unified diff into file hunks for rendering. */
export interface DiffLine {
  type: "meta" | "hunk" | "add" | "del" | "ctx";
  text: string;
}

export function parseUnifiedDiff(stdout: string): DiffLine[] {
  return stdout.split("\n").map((text) => {
    if (text.startsWith("+++") || text.startsWith("---") || text.startsWith("diff ") || text.startsWith("index ")) {
      return { type: "meta" as const, text };
    }
    if (text.startsWith("@@")) return { type: "hunk" as const, text };
    if (text.startsWith("+")) return { type: "add" as const, text };
    if (text.startsWith("-")) return { type: "del" as const, text };
    return { type: "ctx" as const, text };
  });
}

/** Git's placeholder for missing side of a new/deleted file — never a repo path. */
export function isGitNullPath(filePath: string): boolean {
  const trimmed = filePath.trim().replace(/\\/g, "/");
  return trimmed === "/dev/null" || trimmed === "dev/null" || trimmed.endsWith("/dev/null");
}

/**
 * Extract a repo-relative path from a unified-diff `---` / `+++` header.
 * Returns null for `/dev/null` (and never invents `dir/null`).
 */
export function pathFromDiffHeader(header: string): string | null {
  const match = header.match(/^(?:---|\+\+\+)\s+(.*)$/);
  if (!match) return null;
  let raw = (match[1] ?? "").split("\t")[0]?.trim() ?? "";
  if (!raw || isGitNullPath(raw)) return null;
  if (raw.startsWith("a/") || raw.startsWith("b/")) raw = raw.slice(2);
  if (!raw || isGitNullPath(raw)) return null;
  return raw;
}

/** Porcelain / UI hint: untracked directories often end with `/`. */
export function looksLikeDirectoryPath(filePath: string): boolean {
  return filePath.endsWith("/") || filePath.endsWith("\\");
}
