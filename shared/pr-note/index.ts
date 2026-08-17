/**
 * PR-review note path + markdown scaffold — shared by PrRowActions /
 * EntityNoteAction and any MCP/plugin writer.
 */

import {
  buildEntityLinksSection,
  joinMarkdownLines,
  mergeEntityRefs,
  parseEntityLinksFromMarkdown,
  slugify,
  upsertEntityLinksInMarkdown,
  type EntityRef,
} from "../entity-note/index.ts";

export interface PrNoteSource {
  repo: string;
  number: number;
  title: string;
  url: string;
  /** Extra hop-around refs (task, calendar, …). */
  related?: EntityRef[];
  /** Local clone folder name when it differs from the GitHub repo name. */
  localRepoName?: string;
}

export function prNotePath(pr: Pick<PrNoteSource, "repo" | "number">): string {
  const repo = slugify(pr.repo, { maxLen: 80, fallback: "repo" });
  return `pr-reviews/${repo}-${pr.number}`;
}

export function prEntityId(pr: Pick<PrNoteSource, "repo" | "number">): string {
  return `${pr.repo}#${pr.number}`;
}

/** Local-repo entity id: GitHub `owner/name` → `name` (EntityRef `kind: "repo"`). */
export function prRepoLocalName(repo: string): string {
  const trimmed = repo.trim();
  const slash = trimmed.lastIndexOf("/");
  const name = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  return name || trimmed;
}

export function prRepoEntityRef(pr: Pick<PrNoteSource, "repo" | "localRepoName">): EntityRef | null {
  const id = (pr.localRepoName?.trim() || prRepoLocalName(pr.repo)).trim();
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  return { kind: "repo", id, label: id };
}

export function prEntityRefs(pr: PrNoteSource): EntityRef[] {
  const refs: EntityRef[] = [
    {
      kind: "pr",
      id: prEntityId(pr),
      label: `${pr.repo}#${pr.number}`,
      href: pr.url,
    },
  ];
  const repoRef = prRepoEntityRef(pr);
  if (repoRef) refs.push(repoRef);
  if (pr.related?.length) refs.push(...pr.related);
  return mergeEntityRefs(refs);
}

const PR_URL_RE = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/i;

/** PR + repo EntityRefs inferred from a review note body (agent `notes_write`). */
export function inferPrReviewEntityRefs(markdown: string): EntityRef[] {
  const match = markdown.match(PR_URL_RE);
  if (!match?.[1] || !match[2]) return [];
  return prEntityRefs({
    repo: match[1],
    number: Number(match[2]),
    title: "",
    url: `https://github.com/${match[1]}/pull/${match[2]}`,
  });
}

/**
 * Ensure a PR-review note's ## Links include the PR and its repo.
 * Existing links are kept; duplicates are dropped.
 */
export function withPrReviewEntityLinks(markdown: string): string {
  return upsertEntityLinksInMarkdown(
    markdown,
    mergeEntityRefs(parseEntityLinksFromMarkdown(markdown), inferPrReviewEntityRefs(markdown)),
  );
}

export function buildPrNoteMarkdown(pr: PrNoteSource): string {
  const links = buildEntityLinksSection(prEntityRefs(pr));
  return joinMarkdownLines([
    `# ${pr.title}`,
    "",
    `**PR:** [${pr.repo}#${pr.number}](${pr.url})`,
    "",
    links ? links.trimEnd() : null,
    links ? "" : null,
    "## Review",
    "",
    "- ",
    "",
    "## Notes",
    "",
    "- ",
    "",
    "## Follow-ups",
    "",
    "- [ ] ",
  ]);
}
