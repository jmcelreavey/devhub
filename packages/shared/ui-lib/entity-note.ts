/**
 * Cross-entity note link contract — re-export of `shared/entity-note`.
 *
 * Core UI, DevHub MCP (`packages/mcp`), and plugins all speak
 * this shape. Prefer importing builders (`task-note`, `meeting-note`, `pr-note`)
 * for scaffolds; use EntityRef when emitting or parsing ## Links backrefs.
 *
 * Plugins: import from `@/lib/entity-note` (or `@/lib/task-note`) after
 * across core and plugins — do not invent per-plugin link formats.
 */
export {
  buildEntityLinksSection,
  canonicalizeEntityRef,
  defaultHrefForRef,
  entityKey,
  escapeRegExp,
  extractTags,
  formatEntityRefLine,
  joinMarkdownLines,
  mergeEntityRefs,
  parseEntityLinksFromMarkdown,
  parseJiraIssueKey,
  slugify,
  TAG_RE,
  TAG_PARSER_VERSION,
  isTagToken,
  tagRefs,
  upsertEntityLinksInMarkdown,
  type EntityKind,
  type EntityRef,
  type SlugifyOptions,
} from "../entity-note/index.ts";
