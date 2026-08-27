/**
 * Split a repo's open PRs into "mine" vs everyone else.
 *
 * Identity is the same `author:@me` bucket `/api/github/prs` already uses —
 * match authored URLs, then fall back to authored logins (GitHub logins are
 * case-insensitive).
 */
export interface PartitionablePr {
  url: string;
  author?: { login?: string };
}

export function partitionRepoOpenPrs<T extends PartitionablePr>(
  rows: readonly T[],
  authored: readonly PartitionablePr[],
): { mine: T[]; others: T[] } {
  const authoredUrls = new Set(authored.map((row) => row.url).filter(Boolean));
  const authoredLogins = new Set(
    authored
      .map((row) => row.author?.login?.trim().toLowerCase())
      .filter((login): login is string => Boolean(login)),
  );

  const mine: T[] = [];
  const others: T[] = [];
  for (const row of rows) {
    const login = row.author?.login?.trim().toLowerCase();
    if (authoredUrls.has(row.url) || (login && authoredLogins.has(login))) {
      mine.push(row);
    } else {
      others.push(row);
    }
  }
  return { mine, others };
}
