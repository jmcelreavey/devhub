/**
 * One person, assembled from the several addresses they commit under.
 *
 * Git records an identity per commit, not per human, so the same person shows
 * up as separate authors the moment they commit from a second machine or under
 * a work address. Every people-shaped surface in the app — history avatars,
 * standup author matching, review and one-on-one — has been keying on whichever
 * string git happened to record, which is why the same human can appear twice
 * on one screen.
 */
export interface Person {
  /** Stable key: the GitHub login when known, otherwise the primary email. */
  key: string;
  /** Best display name seen — the one attached to the most commits. */
  displayName: string;
  /** Every commit address attributed to this person, lowercased. */
  emails: string[];
  githubLogin: string | null;
  avatarUrl: string | null;
  /** Commits seen across the sampled window. Used to pick the display name. */
  commits: number;
}

/** A commit author as the log parser produced it. */
export interface AuthorSighting {
  name: string;
  email: string;
}

/** email → GitHub account, as `lib/github/commit-authors` resolves it. */
export interface GithubAccount {
  login: string;
  avatarUrl: string;
}

/**
 * email → Atlassian CDN avatar, as `lib/jira/avatars` resolves it.
 * Used only when GitHub did not attribute an avatar for that person.
 */
export type AtlassianAvatarMap = Record<string, string>;

/**
 * Explicit corrections, for when the inference below gets it wrong. Maps an
 * email to the key it should belong to. An escape hatch is necessary because
 * the display-name rule is a heuristic and the user is the only one who can
 * settle a genuine ambiguity.
 */
export type IdentityOverrides = Record<string, string>;

interface Group {
  key: string;
  login: string | null;
  avatarUrl: string | null;
  emails: Set<string>;
  /** displayName → commit count, so the most-used name wins. */
  names: Map<string, number>;
  commits: number;
}

function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function bestName(names: Map<string, number>, fallback: string): string {
  let best = fallback;
  let bestCount = -1;
  for (const [name, count] of names) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Collapse commit authors into people.
 *
 * Two merge rules, in order of confidence:
 *
 * 1. **Same GitHub login.** GitHub resolves an address to the account that owns
 *    it, so two addresses reporting the same login are the same person. This is
 *    an assertion by GitHub, not a guess.
 *
 * 2. **Identical display name, where only one side has a login.** An address
 *    GitHub could not attribute — an unverified personal address, typically —
 *    joins a named group when the name matches exactly and nothing else claims
 *    it. Deliberately never merges two groups that *both* carry a login, since
 *    that would be overriding GitHub with a string comparison.
 *
 * Rule 2 is a heuristic: two different people with the same display name, one of
 * them unattributed, would merge wrongly. Within a single repo that is rare, and
 * the cost is a wrong avatar rather than anything destructive — but it is why
 * `overrides` exists.
 *
 * Avatar preference on the resulting person: GitHub attribution, then Atlassian
 * (Jira user / ticket assignee), else null so the UI can fall through to
 * noreply-derived GitHub → Gravatar → initials.
 */
export function buildPeople(
  sightings: AuthorSighting[],
  accounts: Record<string, GithubAccount>,
  overrides: IdentityOverrides = {},
  atlassianAvatars: AtlassianAvatarMap = {},
): Person[] {
  const groups = new Map<string, Group>();
  /** login → group key, so a second address for a known account finds it. */
  const byLogin = new Map<string, string>();

  function ensure(key: string, login: string | null, avatarUrl: string | null): Group {
    let group = groups.get(key);
    if (!group) {
      group = { key, login, avatarUrl, emails: new Set(), names: new Map(), commits: 0 };
      groups.set(key, group);
    }
    if (login && !group.login) {
      group.login = login;
      group.avatarUrl ??= avatarUrl;
    }
    return group;
  }

  // Pass 1 — group by GitHub login, or by the address itself when unattributed.
  for (const sighting of sightings) {
    const email = sighting.email.trim().toLowerCase();
    if (!email) continue;
    const account = accounts[email];
    const override = overrides[email];
    const key = override ?? (account ? `gh:${account.login.toLowerCase()}` : `email:${email}`);
    const group = ensure(key, account?.login ?? null, account?.avatarUrl ?? null);
    if (account) byLogin.set(account.login.toLowerCase(), key);
    group.emails.add(email);
    group.commits += 1;
    const name = sighting.name.trim();
    if (name) group.names.set(name, (group.names.get(name) ?? 0) + 1);
  }

  // Pass 2 — fold unattributed groups into a login-bearing group of the same
  // name. Sorted so the result does not depend on Map iteration order.
  const attributed = [...groups.values()].filter((g) => g.login);
  const nameIndex = new Map<string, Group[]>();
  for (const group of attributed) {
    for (const name of group.names.keys()) {
      const slot = normaliseName(name);
      nameIndex.set(slot, [...(nameIndex.get(slot) ?? []), group]);
    }
  }

  for (const group of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    if (group.login) continue;
    const names = [...group.names.keys()].map(normaliseName);
    const candidates = new Set(names.flatMap((n) => nameIndex.get(n) ?? []));
    // Exactly one named match, or the name is ambiguous and we leave it alone.
    if (candidates.size !== 1) continue;
    const target = [...candidates][0]!;
    for (const email of group.emails) target.emails.add(email);
    for (const [name, count] of group.names) {
      target.names.set(name, (target.names.get(name) ?? 0) + count);
    }
    target.commits += group.commits;
    groups.delete(group.key);
  }

  // Fill Atlassian avatars only where GitHub left a gap — GH attribution wins.
  for (const group of groups.values()) {
    if (group.avatarUrl) continue;
    for (const email of group.emails) {
      const atl = atlassianAvatars[email];
      if (atl) {
        group.avatarUrl = atl;
        break;
      }
    }
  }

  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      displayName: bestName(group.names, [...group.emails][0] ?? group.key),
      emails: [...group.emails].sort(),
      githubLogin: group.login,
      avatarUrl: group.avatarUrl,
      commits: group.commits,
    }))
    .sort((a, b) => b.commits - a.commits || a.displayName.localeCompare(b.displayName));
}

/** email → person, for the lookups every consumer actually performs. */
export function indexByEmail(people: Person[]): Record<string, Person> {
  const index: Record<string, Person> = {};
  for (const person of people) {
    for (const email of person.emails) {
      const key = email.trim().toLowerCase();
      if (key) index[key] = person;
    }
  }
  return index;
}

/**
 * Case-insensitive map lookup. Identity keys are lowercased; `git show` emails
 * are not, and a raw `map[email]` miss is what left history rows on initials
 * while the detail header (which already lowercased) showed the photo.
 */
export function lookupByEmail<T>(index: Record<string, T>, email: string): T | undefined {
  const key = email.trim().toLowerCase();
  return key ? index[key] : undefined;
}

/**
 * The person a given address belongs to. Falls back to a lone-address person so
 * callers never have to handle a miss — an author we have never seen is still a
 * person, just one we know nothing else about.
 */
export function personForEmail(
  index: Record<string, Person>,
  email: string,
  displayName = "",
): Person {
  const key = email.trim().toLowerCase();
  const found = index[key];
  if (found) return found;
  return {
    key: `email:${key}`,
    displayName: displayName.trim() || key,
    emails: key ? [key] : [],
    githubLogin: null,
    avatarUrl: null,
    commits: 0,
  };
}
