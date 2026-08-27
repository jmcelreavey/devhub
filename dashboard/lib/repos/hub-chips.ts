import { entityKey, type EntityRef } from "../entity-note";
import { repoLinkMatches } from "./repo-link-match";

/**
 * Links that every row in a list carries.
 *
 * A backlog of nine tickets cut from one plan note repeats that note's chip
 * nine times, which says nothing about any individual row. The shared links get
 * hoisted to the section header and suppressed on the rows instead.
 *
 * A link shared by *some* rows still distinguishes them, so it stays put.
 */
export function commonTaskRefs(
  tasks: readonly { links?: EntityRef[] }[],
  opts: { repoName?: string; minRows?: number } = {},
): EntityRef[] {
  const minRows = opts.minRows ?? 2;
  if (tasks.length < minRows) return [];

  const [first, ...rest] = tasks;
  const candidates = (first?.links ?? []).filter((ref) => !isOwnRepoRef(ref, opts.repoName));
  if (candidates.length === 0) return [];

  const seen = new Set<string>();
  return candidates.filter((ref) => {
    const key = entityKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return rest.every((task) => (task.links ?? []).some((other) => entityKey(other) === key));
  });
}

/** The repo chip is already suppressed on its own repo page; don't resurrect it. */
function isOwnRepoRef(ref: EntityRef, repoName: string | undefined): boolean {
  return Boolean(repoName) && ref.kind === "repo" && repoLinkMatches(ref.id, repoName!, null);
}
