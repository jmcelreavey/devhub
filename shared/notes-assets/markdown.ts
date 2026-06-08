/**
 * Client-safe note asset path helpers (no Node fs). Used by markdown convert in the browser.
 */

/** URL prefix served by the dashboard for binary files under the notes root. */
export const NOTES_ASSETS_API_PREFIX = '/api/notes-assets/';

const IMAGE_MARKDOWN_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

/** Normalize a notes-relative asset path (forward slashes, no leading slash). */
export function normalizeNoteAssetRelPath(raw: string): string {
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

/** Browser-loadable URL for a notes-relative asset path. */
export function toNoteAssetApiUrl(notesRelativePath: string): string {
  const normalized = normalizeNoteAssetRelPath(notesRelativePath);
  const encoded = normalized
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `${NOTES_ASSETS_API_PREFIX}${encoded}`;
}

/** Notes-relative path for markdown/MCP (strip API prefix when present). */
export function toNoteAssetMarkdownPath(urlOrPath: string): string {
  const trimmed = urlOrPath.trim();
  if (trimmed.startsWith(NOTES_ASSETS_API_PREFIX)) {
    const rest = trimmed.slice(NOTES_ASSETS_API_PREFIX.length);
    return normalizeNoteAssetRelPath(
      rest
        .split('/')
        .map(s => {
          try {
            return decodeURIComponent(s);
          } catch {
            return s;
          }
        })
        .join('/'),
    );
  }
  return normalizeNoteAssetRelPath(trimmed.replace(/^\//, ''));
}

export function parseImageMarkdownLine(line: string): { caption: string; path: string } | null {
  const match = line.trim().match(IMAGE_MARKDOWN_RE);
  if (!match) return null;
  return { caption: match[1] ?? '', path: match[2] ?? '' };
}

export function imageMarkdownLine(caption: string, notesRelativePath: string): string {
  const assetPath = toNoteAssetMarkdownPath(notesRelativePath);
  const alt = caption.replace(/\]/g, '\\]');
  return `![${alt}](${assetPath})`;
}
