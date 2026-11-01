/**
 * "Tags: #a #b" lines in task notes. The markdown stays a plain line; the editor
 * and the visual sections only dress the tokens as pills, so the stored note
 * round-trips unchanged.
 */

/** Same shape as `TAG_RE` in shared/entity-note: a letter or underscore first, so `#525` is never a tag. */
const TAG_TOKEN = /#([a-z_][a-z0-9_-]{0,31})/gi;
const LABEL = /^(\s*)(tags:)/i;

export interface TagLineToken {
  /** Lowercased tag without the `#`. */
  tag: string;
  /** Offsets of `#tag` within the line text. */
  start: number;
  end: number;
}

export interface TagLine {
  /** Offsets of `Tags:` (colon included). */
  label: { start: number; end: number };
  tags: TagLineToken[];
}

/**
 * Parse a line that is only a `Tags:` label followed by `#tags` (spaces or commas
 * between them). Anything else on the line, such as prose or a malformed token,
 * makes it an ordinary line: null.
 */
export function parseTagLine(text: string): TagLine | null {
  const head = LABEL.exec(text);
  if (!head) return null;
  const labelStart = head[1].length;
  const labelEnd = labelStart + head[2].length;
  const tags: TagLineToken[] = [];
  let cursor = labelEnd;
  const rest = text.slice(labelEnd);
  for (const part of rest.matchAll(/[^\s,]+/g)) {
    const token = part[0];
    TAG_TOKEN.lastIndex = 0;
    const match = TAG_TOKEN.exec(token);
    if (!match || match[0] !== token) return null;
    const start = labelEnd + (part.index ?? 0);
    tags.push({ tag: match[1].toLowerCase(), start, end: start + token.length });
    cursor = start + token.length;
  }
  if (tags.length === 0 || text.slice(cursor).trim() !== "") return null;
  return { label: { start: labelStart, end: labelEnd }, tags };
}
