import { runGitRepoAsync } from "@/lib/git/repo-local";
import { loadCommitAuthors, type CommitAuthorMap } from "@/lib/github/commit-authors";
import { resolveAtlassianAvatars } from "@/lib/jira/avatars";
import { getGithubFullNameForLocalRepo } from "@/lib/repos";
import { ttlCacheByKey } from "@/lib/ttl-cache";
import { buildPeople, indexByEmail, type AuthorSighting, type Person } from "@/lib/people/identity";

const TTL_MS = 30 * 60_000;
/**
 * Deep enough that an occasional contributor still appears, shallow enough that
 * this stays one fast local call. `git log` over a few thousand commits is
 * milliseconds; it is the GitHub lookup beside it that costs anything.
 */
const SIGHTING_LIMIT = 4000;

/** Every author across all refs — the population the identity layer merges. */
export async function collectSightings(repoRoot: string): Promise<AuthorSighting[]> {
  const log = await runGitRepoAsync(repoRoot, [
    "log",
    "--all",
    `--max-count=${SIGHTING_LIMIT}`,
    "--format=%an%x00%ae",
  ]);
  if (log.status !== 0) return [];
  return log.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", email = ""] = line.split("\0");
      return { name, email };
    });
}

export interface RepoPeople {
  people: Person[];
  /** email → person, precomputed because every consumer looks up by address. */
  byEmail: Record<string, Person>;
  /** False when the repo has no GitHub remote, so accounts could not be resolved. */
  githubConfigured: boolean;
}

/**
 * People for a repo, merged across the addresses each of them commits under.
 *
 * Cached per repo: the git half is cheap but the GitHub / Atlassian half is
 * network, and this is read by several surfaces (history avatars, standup
 * author matching) that would otherwise each pay for it.
 *
 * Avatar cascade into `Person.avatarUrl`: GitHub attribution → Atlassian
 * (Jira) → null (UI then tries noreply GitHub / Gravatar / initials).
 */
export const loadRepoPeople = ttlCacheByKey<string, RepoPeople>(async (repoRoot) => {
  const fullName = getGithubFullNameForLocalRepo(repoRoot);
  const [sightings, accounts] = await Promise.all([
    collectSightings(repoRoot),
    fullName ? loadCommitAuthors(fullName) : Promise.resolve({} as CommitAuthorMap),
  ]);
  const emailsNeedingAtlassian = [
    ...new Set(
      sightings
        .map((s) => s.email.trim().toLowerCase())
        .filter((email) => email && !accounts[email]),
    ),
  ];
  const atlassianAvatars = await resolveAtlassianAvatars(emailsNeedingAtlassian);
  const people = buildPeople(sightings, accounts, {}, atlassianAvatars);
  return { people, byEmail: indexByEmail(people), githubConfigured: Boolean(fullName) };
}, TTL_MS);
