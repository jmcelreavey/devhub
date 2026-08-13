/**
 * Splitting documents into retrievable pieces.
 *
 * Whole-document retrieval is what `/api/search` does today, and it is why the
 * context pack is so expensive: matching one line of a 900-line daily note
 * costs you the whole note, or a truncation that cuts the relevant part out.
 * Chunking makes retrieval cost proportional to what was actually relevant.
 */

/** Target chunk size in characters. ~200 tokens — small enough to pack several. */
const TARGET_CHARS = 900;
/** Never emit a chunk below this unless it's the only content. */
const MIN_CHARS = 120;
/**
 * Overlap between adjacent chunks. Without it, a fact split across a boundary
 * is retrievable from neither half.
 */
const OVERLAP_CHARS = 120;

export interface TextChunk {
  ordinal: number;
  text: string;
  /** Nearest preceding markdown heading, used as the chunk's display title. */
  heading?: string;
}

function lastHeading(lines: readonly string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = /^#{1,6}\s+(.{1,120})$/.exec(lines[i].trim());
    if (match) return match[1].trim();
  }
  return undefined;
}

/**
 * Split on blank lines and headings, then greedily pack paragraphs up to the
 * target size.
 *
 * Paragraph-first rather than fixed-window because a mid-sentence split makes
 * both halves read as noise, and the vector side is trigram-based — it degrades
 * badly on fragments.
 */
export function chunkText(text: string): TextChunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= TARGET_CHARS) {
    return [{ ordinal: 0, text: trimmed, heading: lastHeading(trimmed.split("\n")) }];
  }

  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .flatMap((para) => {
      // A single paragraph longer than two chunks gets hard-split; a wall of
      // text with no blank lines is otherwise unchunkable.
      if (para.length <= TARGET_CHARS * 2) return [para];
      const pieces: string[] = [];
      for (let i = 0; i < para.length; i += TARGET_CHARS) {
        pieces.push(para.slice(i, i + TARGET_CHARS));
      }
      return pieces;
    })
    .map((para) => para.trim())
    .filter(Boolean);

  const chunks: TextChunk[] = [];
  const seenLines: string[] = [];
  let buffer: string[] = [];
  let bufferLength = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    const body = buffer.join("\n\n");
    chunks.push({
      ordinal: chunks.length,
      text: body,
      heading: lastHeading(seenLines),
    });
    seenLines.push(...body.split("\n"));

    const tail = body.slice(-OVERLAP_CHARS);
    buffer = tail.trim() ? [tail.trim()] : [];
    bufferLength = buffer[0]?.length ?? 0;
  };

  for (const para of paragraphs) {
    if (bufferLength > 0 && bufferLength + para.length > TARGET_CHARS) flush();
    buffer.push(para);
    bufferLength += para.length + 2;
  }

  if (bufferLength >= MIN_CHARS || chunks.length === 0) {
    if (buffer.length > 0) {
      chunks.push({
        ordinal: chunks.length,
        text: buffer.join("\n\n"),
        heading: lastHeading(seenLines),
      });
    }
  } else if (buffer.length > 0 && chunks.length > 0) {
    // A short trailing remainder is appended to the previous chunk rather than
    // emitted alone — a 40-character chunk is never the right answer to
    // anything, but losing it entirely is worse.
    chunks[chunks.length - 1] = {
      ...chunks[chunks.length - 1],
      text: `${chunks[chunks.length - 1].text}\n\n${buffer.join("\n\n")}`,
    };
  }

  return chunks;
}

/** The line of `text` that best matches the query tokens, for previews. */
export function bestSnippet(text: string, queryTokens: readonly string[], maxLen = 220): string {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return "";
  if (queryTokens.length === 0) return lines[0].slice(0, maxLen);

  let best = lines[0];
  let bestScore = -1;
  for (const line of lines) {
    const lower = line.toLowerCase();
    let score = 0;
    for (const token of queryTokens) if (lower.includes(token)) score += 1;
    // Prefer the earliest line among ties: it is usually the heading or lede.
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return best.trim().slice(0, maxLen);
}
