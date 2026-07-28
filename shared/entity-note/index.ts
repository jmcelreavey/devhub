/**
 * Shared helpers for notes derived from workspace entities (meetings, tasks, …).
 * Path/markdown builders live beside their entity; this module owns the tiny
 * bits every builder needs so we don't copy slugify three times.
 */

export interface SlugifyOptions {
  maxLen?: number;
  fallback?: string;
}

export function slugify(text: string, options: SlugifyOptions = {}): string {
  const { maxLen = 48, fallback = "untitled" } = options;
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, maxLen) || fallback;
}

/** Join markdown lines, dropping null/undefined entries (optional fields). */
export function joinMarkdownLines(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => line != null).join("\n");
}

/**
 * A short "## Links" block pointing back at the source entity.
 * Keep markers (task-ref, calendar URLs, …) as plain markdown so vault
 * convert + TaskRefBlock keep working without a frontmatter schema.
 */
export function buildEntityLinksSection(lines: Array<string | null | undefined>): string {
  const body = lines.filter((line): line is string => line != null && line !== "");
  if (body.length === 0) return "";
  return ["## Links", "", ...body, ""].join("\n");
}
