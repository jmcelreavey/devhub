import { blocksToText } from "@/lib/markdown-convert";
import { parseFrontmatter } from "@/lib/docs/frontmatter";

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** First markdown heading (#–###), or undefined. */
export function firstHeadingFromMarkdown(markdown: string): string | undefined {
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (match) return match[2].trim() || undefined;
  }
  return undefined;
}

/** First heading from BlockNote JSON blocks. */
export function firstHeadingFromBlocks(blocks: unknown[]): string | undefined {
  return firstHeadingFromMarkdown(blocksToText(blocks));
}

/**
 * Docs title: frontmatter.title, else first H1, else undefined.
 * Pass the full source (frontmatter + body) or body alone.
 */
export function titleFromDocMarkdown(markdown: string): string | undefined {
  const { frontmatter, body } = parseFrontmatter(markdown);
  if (frontmatter.title?.trim()) return frontmatter.title.trim();
  return firstHeadingFromMarkdown(body);
}

/**
 * Shorten machine filenames (date+UUID task notes) so they don't dominate the header.
 * Human-readable names pass through unless absurdly long.
 */
export function truncateMachineFilename(name: string, max = 36): string {
  if (UUID_RE.test(name)) {
    const dated = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(name);
    if (dated) {
      const rest = dated[2];
      const short = UUID_RE.test(rest) ? rest.slice(0, 8) : rest.slice(0, 12);
      return `${dated[1]}-${short}…`;
    }
    return `${name.slice(0, 12)}…`;
  }
  if (name.length > max) return `${name.slice(0, max - 1)}…`;
  return name;
}

/**
 * Header / gist title: prefer content title, else a truncated filename.
 * `fileName` is the path basename (no folder).
 */
export function vaultDisplayTitle(
  fileName: string,
  contentTitle?: string | null,
): { displayTitle: string; fileName: string; fromContent: boolean } {
  const trimmed = contentTitle?.trim();
  if (trimmed) {
    return { displayTitle: trimmed, fileName, fromContent: true };
  }
  return {
    displayTitle: truncateMachineFilename(fileName),
    fileName,
    fromContent: false,
  };
}
