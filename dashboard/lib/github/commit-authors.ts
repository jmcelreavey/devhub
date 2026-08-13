import { execGh } from "@/lib/gh-exec";
import { ttlCacheByKey } from "@/lib/ttl-cache";

/**
 * Author avatars, resolved by GitHub rather than by us.
 *
 * Gravatar can only answer for an address its owner registered, which in
 * practice means personal addresses — the work addresses that make up most of a
 * company repo's history return nothing. GitHub already knows which account
 * owns which commit email and says so on every commit it returns, so asking it
 * covers exactly the authors Gravatar cannot, using auth the user already has
 * via `gh`.
 *
 * There is no endpoint that maps an arbitrary email to a user, so this samples
 * recent commits and builds the map from what comes back. That is a good fit
 * for the history view: the authors on screen are by definition the ones who
 * committed recently.
 */

/** Shape of the bits of `GET /repos/{owner}/{repo}/commits` we read. */
interface GhCommitEntry {
  commit?: { author?: { email?: string | null } | null } | null;
  author?: { login?: string | null; avatar_url?: string | null } | null;
}

export interface CommitAuthor {
  login: string;
  avatarUrl: string;
}

/** email (lowercased) → GitHub account. */
export type CommitAuthorMap = Record<string, CommitAuthor>;

/** Two pages is enough to cover every active author without a slow fan-out. */
const PAGES = 2;
const PER_PAGE = 100;
const TTL_MS = 30 * 60_000;

/**
 * Build the map from a commits payload. Skips entries GitHub could not attribute
 * (`author: null`, which is what a commit from an address with no account looks
 * like) — a missing entry is meaningful, since it lets the caller fall through
 * to Gravatar rather than showing nothing.
 */
export function parseCommitAuthors(entries: GhCommitEntry[]): CommitAuthorMap {
  const map: CommitAuthorMap = {};
  for (const entry of entries) {
    const email = entry.commit?.author?.email?.trim().toLowerCase();
    const login = entry.author?.login?.trim();
    const avatarUrl = entry.author?.avatar_url?.trim();
    if (!email || !login || !avatarUrl) continue;
    // Only accept avatars from GitHub's own CDN. The value is interpolated into
    // an <img src>, and this payload is remote data.
    if (!/^https:\/\/avatars\.githubusercontent\.com\//.test(avatarUrl)) continue;
    map[email] ??= { login, avatarUrl };
  }
  return map;
}

async function fetchPage(fullName: string, page: number): Promise<GhCommitEntry[]> {
  const { stdout } = await execGh([
    "api",
    `repos/${fullName}/commits?per_page=${PER_PAGE}&page=${page}`,
  ]);
  const parsed: unknown = JSON.parse(stdout.trim() || "[]");
  return Array.isArray(parsed) ? (parsed as GhCommitEntry[]) : [];
}

/**
 * Resolve author avatars for a repo. Returns an empty map rather than throwing:
 * `gh` may be absent, logged out, or the repo may not be on GitHub at all, and
 * none of those should surface as an error in a history view whose avatars are
 * decoration. The caller degrades to Gravatar and then initials.
 */
export const loadCommitAuthors = ttlCacheByKey<string, CommitAuthorMap>(
  async (fullName) => {
    try {
      const pages = await Promise.all(
        Array.from({ length: PAGES }, (_, i) => fetchPage(fullName, i + 1)),
      );
      return parseCommitAuthors(pages.flat());
    } catch {
      return {};
    }
  },
  TTL_MS,
);
