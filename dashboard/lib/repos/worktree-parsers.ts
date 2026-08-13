/**
 * Parsers and path rules for `git worktree`.
 *
 * A worktree is a second checkout backed by the same repository, so two
 * branches can be open at once without stashing between them. That matters here
 * more than it does in a general Git client: DevHub's premise is running agents
 * across repos, and agents working parallel branches in a single checkout
 * contend for one working tree — one `git checkout` and another agent's build
 * is reading half-swapped files.
 */

export interface Worktree {
  path: string;
  /** Commit the tree is on. Empty for a worktree that has never been checked out. */
  head: string;
  /** Short branch name, or null when HEAD is detached. */
  branch: string | null;
  /** The repository's own working tree — cannot be removed. */
  isMain: boolean;
  detached: boolean;
  /** Locked worktrees refuse removal until unlocked; the reason may be empty. */
  locked: boolean;
  lockReason: string;
  /** Git believes the working tree is gone (e.g. an unmounted volume). */
  prunable: boolean;
}

/**
 * Parse `git worktree list --porcelain`.
 *
 * Records are blank-line separated; the first is always the main working tree.
 * Attribute lines are either bare flags (`bare`, `detached`) or `key value`.
 */
export function parseWorktreeList(stdout: string): Worktree[] {
  const records = stdout.split(/\n\s*\n/).map((r) => r.trim()).filter(Boolean);
  return records.map((record, index) => {
    const tree: Worktree = {
      path: "",
      head: "",
      branch: null,
      isMain: index === 0,
      detached: false,
      locked: false,
      lockReason: "",
      prunable: false,
    };
    for (const line of record.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const space = trimmed.indexOf(" ");
      const key = space === -1 ? trimmed : trimmed.slice(0, space);
      const value = space === -1 ? "" : trimmed.slice(space + 1).trim();
      switch (key) {
        case "worktree":
          tree.path = value;
          break;
        case "HEAD":
          tree.head = value;
          break;
        case "branch":
          // Reported as a full ref; the short name is what anyone reads.
          tree.branch = value.replace(/^refs\/heads\//, "");
          break;
        case "detached":
          tree.detached = true;
          break;
        case "locked":
          tree.locked = true;
          tree.lockReason = value;
          break;
        case "prunable":
          tree.prunable = true;
          break;
        default:
          break;
      }
    }
    return tree;
  }).filter((tree) => tree.path);
}

/** Filesystem-safe slug for a branch name, for use in a directory name. */
export function worktreeSlug(branch: string): string {
  return (
    branch
      .trim()
      .replace(/^refs\/heads\//, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "worktree"
  );
}

/**
 * Default location for a new worktree: a sibling of the repository.
 *
 * Sibling rather than nested. A worktree inside the repo shows up as untracked
 * files in its own parent unless it is gitignored, and a sibling lands in the
 * same scan directory — so DevHub lists it as a repo of its own, which is what
 * it is and what you want when handing it to an agent.
 */
export function defaultWorktreePath(repoRoot: string, branch: string): string {
  const clean = repoRoot.replace(/\/+$/, "");
  const slash = clean.lastIndexOf("/");
  const parent = slash > 0 ? clean.slice(0, slash) : "";
  const name = slash === -1 ? clean : clean.slice(slash + 1);
  return `${parent}/${name}--${worktreeSlug(branch)}`;
}

/**
 * Reject a target path that is not somewhere a worktree should go.
 *
 * The path reaches `git worktree add` as an argument, so it is checked rather
 * than trusted: absolute, no traversal segments, not inside the repository
 * itself (which would nest a checkout in its own working tree), and not the
 * repository root.
 */
export function worktreePathError(repoRoot: string, target: string): string | null {
  const path = target.trim();
  if (!path) return "Choose a folder for the new worktree.";
  if (!path.startsWith("/")) return "Use an absolute path.";
  if (path.split("/").includes("..")) return "The path cannot contain '..'.";
  const root = repoRoot.replace(/\/+$/, "");
  const clean = path.replace(/\/+$/, "");
  if (clean === root) return "That is the repository itself.";
  if (clean.startsWith(`${root}/`)) {
    return "Pick a folder outside the repository — a worktree inside it shows up as untracked files.";
  }
  return null;
}
