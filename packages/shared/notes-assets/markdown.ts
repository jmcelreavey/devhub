/**
 * Client-safe note asset path helpers (no Node fs). Used by markdown convert in the browser.
 */

/** URL prefix served by the dashboard for binary files under the notes root. */
export const NOTES_ASSETS_API_PREFIX = '/api/notes-assets/';

/** Content-addressed pasted images; the URL is already stable and is not a vault path. */
export const NOTES_MEDIA_API_PREFIX = '/api/notes-media/';

const IMAGE_MARKDOWN_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

/** Remote media (e.g. a CI screenshot URL) is referenced as-is, never treated as a vault path. */
export function isExternalMediaUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** Video files are embedded as a video block instead of an image. */
export function isVideoMediaPath(value: string): boolean {
  return /\.(mp4|webm)(?:[?#].*)?$/i.test(value.trim());
}

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
  if (notesRelativePath.startsWith(NOTES_MEDIA_API_PREFIX) || isExternalMediaUrl(notesRelativePath)) {
    return notesRelativePath;
  }
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
  if (trimmed.startsWith(NOTES_MEDIA_API_PREFIX) || isExternalMediaUrl(trimmed)) return trimmed;
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
