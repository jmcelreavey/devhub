import type { TaskNoteLink } from "@shared/task-note/meta.ts";

const JIRA_KEY = /^[A-Z][A-Z0-9]+-\d+$/;
const GITHUB_PR = /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/;

/**
 * Short pill text. Older notes carry "app#170 — existing release workflows"; the
 * pill is the short part. PR titles that start with the Jira key ("PTF-5195 — …")
 * would all collapse to the key, so PRs show repo#number from their URL instead.
 */
export function pillText(link: TaskNoteLink): string {
  const href = link.href ?? "";
  const pr = GITHUB_PR.exec(href);
  if (link.kind === "pr" && pr) return `${pr[1]}#${pr[2]}`;
  const [short, ...rest] = link.label.split(/\s+[—-]\s+/);
  if (link.kind !== "jira" && short && JIRA_KEY.test(short) && rest.length > 0) return rest.join(" — ");
  return short || link.label;
}

/**
 * A comparable form of where a link goes. GitHub PR pages (`/pull/12`, `/pull/12/files`,
 * `#discussion_r…`) are one destination; otherwise the host is case-insensitive, the
 * fragment and trailing slashes do not matter, and query order does not matter.
 * Paths stay case-sensitive. Relative hrefs (`/work?tab=tasks`) are compared as written
 * minus the same noise. No href: undefined.
 */
export function destinationKey(href: string | undefined): string | undefined {
  const raw = href?.trim();
  if (!raw) return undefined;
  const pr = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/(\d+)/i.exec(raw);
  if (pr) return `pr:${pr[1]}/${pr[2]}#${pr[3]}`.toLowerCase();
  try {
    const url = new URL(raw, "http://relative.invalid");
    url.searchParams.sort();
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const origin = url.origin === "http://relative.invalid" ? "" : url.origin.toLowerCase();
    return `${origin}${path}${url.search}`;
  } catch {
    return raw.replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

/**
 * One pill per destination. Two links to the same place collapse to the first. Links that
 * share only their short text ("Plan — A", "Plan — B" both read "Plan") stay apart when
 * both have a destination; a link without an href is a duplicate of a same-kind, same-text
 * link, and the one with the href is kept.
 */
export function dedupePillLinks(links: readonly TaskNoteLink[]): TaskNoteLink[] {
  const out: Array<{ link: TaskNoteLink; dest: string | undefined }> = [];
  const byDest = new Set<string>();
  const byText = new Map<string, number>();
  for (const link of links) {
    const dest = destinationKey(link.href);
    if (dest && byDest.has(dest)) continue;
    const textKey = `${link.kind}:${pillText(link).toLowerCase()}`;
    const twin = byText.get(textKey);
    if (twin !== undefined && (!dest || !out[twin].dest)) {
      if (dest && !out[twin].dest) {
        out[twin] = { link, dest };
        byDest.add(dest);
      }
      continue;
    }
    if (dest) byDest.add(dest);
    if (twin === undefined) byText.set(textKey, out.length);
    out.push({ link, dest });
  }
  return out.map((entry) => entry.link);
}
