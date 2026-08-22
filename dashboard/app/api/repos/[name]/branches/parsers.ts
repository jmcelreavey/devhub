export function parseChangedFiles(stdout: string) {
  return stdout
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 20)
    .map((line) => ({
      status: line.slice(0, 2).trim() || "changed",
      path: line.slice(3),
    }));
}

export function parseUnpushedCommits(stdout: string) {
  return stdout
    .split("\u001e")
    .filter((chunk) => chunk.trim())
    .slice(0, 10)
    .map((chunk) => {
      const [head = "", ...files] = chunk.trim().split("\n");
      const parts = head.split("\0");
      // Prefer `%H%x00%h%x00%s`; fall back to legacy `%h%x00%s`.
      const hash = parts.length >= 3 ? (parts[0] ?? "") : "";
      const shortHash = parts.length >= 3 ? (parts[1] ?? "") : (parts[0] ?? "");
      const subject = parts.length >= 3 ? (parts[2] ?? "") : (parts[1] ?? "");
      return {
        hash: hash || shortHash,
        shortHash: shortHash || hash.slice(0, 7),
        subject,
        files: files.filter(Boolean).slice(0, 10),
      };
    });
}

/** Parse `git rev-list --left-right --count A...B` → `{ left, right }`. */
export function parseLeftRightCount(stdout: string): { left: number; right: number } {
  const [leftRaw = "0", rightRaw = "0"] = stdout.trim().split(/\s+/);
  const left = Number(leftRaw);
  const right = Number(rightRaw);
  return {
    left: Number.isFinite(left) ? left : 0,
    right: Number.isFinite(right) ? right : 0,
  };
}

export interface UpstreamTrack {
  ahead: number;
  behind: number;
  /** Upstream ref no longer exists on the remote. */
  gone: boolean;
}

/**
 * Parse `%(upstream:track)` → ahead/behind vs the branch's own upstream.
 *
 * Output shapes: `""` (in sync), `"[ahead 2]"`, `"[behind 3]"`,
 * `"[ahead 1, behind 4]"`, `"[gone]"`. One for-each-ref column covers every
 * branch, so the rail gets per-branch arrows without N rev-list calls.
 */
export function parseUpstreamTrack(raw: string): UpstreamTrack {
  const text = raw.trim();
  if (!text) return { ahead: 0, behind: 0, gone: false };
  if (/gone/i.test(text)) return { ahead: 0, behind: 0, gone: true };
  const ahead = Number(text.match(/ahead (\d+)/i)?.[1] ?? 0);
  const behind = Number(text.match(/behind (\d+)/i)?.[1] ?? 0);
  return {
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
    gone: false,
  };
}

/**
 * Local branch names we're willing to hand to git as a positional argument.
 *
 * Deliberately narrower than git's own rules: no whitespace or NUL (so a name
 * can't split into extra argv entries), no leading `-` (so it can't become a
 * flag), and no `..` (so it can't turn into a range).
 */
export function isSafeBranchName(branch: unknown): branch is string {
  if (typeof branch !== "string" || !branch || branch.length > 200) return false;
  if (branch.includes("..") || branch.includes("\0") || /\s/.test(branch)) return false;
  if (branch.startsWith("-") || branch.startsWith("/") || branch.endsWith("/")) return false;
  if (branch.endsWith(".lock") || branch.endsWith(".")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(branch);
}
