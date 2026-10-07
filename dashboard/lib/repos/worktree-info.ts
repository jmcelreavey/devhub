import type { Worktree } from "./worktree-parsers";

export interface WorktreeTask {
  id: string;
  title: string;
  date: string;
  jiraKey?: string;
  finished: boolean;
}
export interface WorktreeNote { title: string; href: string }
export interface WorktreeRun {
  id: string;
  title: string;
  status: string;
  active: boolean;
  updatedAt: number;
}
export interface WorktreeMerge {
  verified: boolean;
  reason: string;
  openPr?: { number: number; url: string };
  pr?: { number: number; url: string; head: string; mergedAt: string };
}
export interface WorktreeInfo extends Worktree {
  merge?: WorktreeMerge;
  title: string;
  tasks: WorktreeTask[];
  notes: WorktreeNote[];
  runs: WorktreeRun[];
  pr?: { url: string; state?: string; checkedAt?: string };
  details?: {
    dirtyCount: number | null;
    unpushedCount: number | null;
    sizeBytes: number | null;
    ignoredPaths: string[];
    lastActivity: number | null;
    blockers: string[];
    candidate: boolean;
    reason: string;
  };
}
export interface WorktreeInventory {
  mergedCleanupSupported: true;
  worktrees: WorktreeInfo[];
  repoRoot: string;
  preferredPath?: string | null;
}

export function isWorktreeCleanupReady(tree: WorktreeInfo): boolean {
  return !tree.isMain && !tree.locked && !tree.prunable && !tree.merge?.openPr
    && tree.merge?.verified === true && tree.details?.candidate === true && tree.details.blockers.length === 0;
}

/** Human-readable fallback only; the exact branch remains visible alongside it. */
export function worktreeTitle(tree: Pick<Worktree, "branch" | "head" | "isMain">): string {
  if (tree.isMain) return "Main checkout";
  if (!tree.branch) return `Detached checkout · ${(tree.head || "").slice(0, 7)}`;
  const branch = tree.branch.replace(/^devhub\/agent\//, "").replace(/-?run-[a-z0-9]+-[a-f0-9]+$/i, "");
  return branch.replace(/([A-Za-z]+)-(\d+)/g, (_, key: string, n: string) => `${key.toUpperCase()}~${n}`)
    .replace(/[-_/]+/g, " ").replace(/~/g, "-").trim() || "Agent checkout";
}

export function workspaceOption(tree: WorktreeInfo, currentPath: string) {
  const title = tree.title || worktreeTitle(tree);
  const branch = tree.branch?.startsWith("devhub/agent/")
    ? worktreeTitle({ ...tree, isMain: false })
    : tree.branch || `Detached at ${tree.head?.slice(0, 7) || "unknown commit"}`;
  const note = tree.notes?.[0]?.title;
  const status = [
    tree.runs?.[0] ? `Agent ${tree.runs[0].status}` : null,
    note ? `Note: ${note}${tree.notes.length > 1 ? ` (+${tree.notes.length - 1})` : ""}` : null,
  ].filter(Boolean).join(" · ");
  return {
    value: tree.path, label: title,
    description: [`${branch}${tree.path === currentPath ? " · Current checkout" : ""}`, status].filter(Boolean).join("\n"),
    hint: [tree.branch, tree.path, ...(tree.tasks ?? []).map((task) => task.jiraKey), ...(tree.notes ?? []).map((note) => note.title)].filter(Boolean).join("\n"),
  };
}
