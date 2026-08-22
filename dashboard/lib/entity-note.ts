/**
 * Cross-entity note link contract — re-export of `shared/entity-note`.
 *
 * Core UI, DevHub MCP (`mcp-servers/devhub-server`), and plugins all speak
 * this shape. Prefer importing builders (`task-note`, `meeting-note`, `pr-note`)
 * for scaffolds; use EntityRef when emitting or parsing ## Links backrefs.
 *
 * Plugins: import from `@/lib/entity-note` (or `@/lib/task-note`) after
 * materialize — do not invent per-plugin link formats.
 */
export {
  buildEntityLinksSection,
  defaultHrefForRef,
  entityKey,
  formatEntityRefLine,
  joinMarkdownLines,
  mergeEntityRefs,
  parseEntityLinksFromMarkdown,
  slugify,
  tagRefs,
  upsertEntityLinksInMarkdown,
  type EntityKind,
  type EntityRef,
  type SlugifyOptions,
} from "../../shared/entity-note/index.ts";
