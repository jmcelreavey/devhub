/**
 * PR-review note path + markdown scaffold — shared by PrRowActions /
 * EntityNoteAction and any MCP/plugin writer.
 */

import {
  buildEntityLinksSection,
  joinMarkdownLines,
  slugify,
  type EntityRef,
} from "../entity-note/index.ts";

export interface PrNoteSource {
  repo: string;
  number: number;
  title: string;
  url: string;
  /** Extra hop-around refs (task, calendar, …). */
  related?: EntityRef[];
}

export function prNotePath(pr: Pick<PrNoteSource, "repo" | "number">): string {
  const repo = slugify(pr.repo, { maxLen: 80, fallback: "repo" });
  return `pr-reviews/${repo}-${pr.number}`;
}

export function prEntityId(pr: Pick<PrNoteSource, "repo" | "number">): string {
  return `${pr.repo}#${pr.number}`;
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
  if (pr.related?.length) refs.push(...pr.related);
  return refs;
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
