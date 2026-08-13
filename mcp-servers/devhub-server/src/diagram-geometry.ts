/**
 * Headless geometry for tldraw shapes.
 *
 * tldraw only recomputes a note's `growY` inside the editor: `NoteShapeUtil.
 * getNoteSizeAdjustments` runs from `onBeforeCreate`/`onBeforeUpdate`, and a snapshot
 * loaded from disk never passes through either. So a note written headlessly keeps
 * whatever `growY` we hand it — write `0` and text taller than the 200px box paints
 * outside the shape and collides with its neighbours. We measure it here instead.
 *
 * Constants mirror tldraw 5.x: `NoteShapeUtil` (noteWidth/noteHeight 200),
 * `LABEL_PADDING` 16, `DEFAULT_THEME` (fontSize 16, lineHeight 1.35), `LABEL_FONT_SIZES`.
 */

export type ShapeSize = "s" | "m" | "l" | "xl";

export const NOTE_SIZE = 200;
export const LABEL_PADDING = 16;
export const THEME_FONT_SIZE = 16;
export const THEME_LINE_HEIGHT = 1.35;

/** tldraw's LABEL_FONT_SIZES, as multiples of the theme font size. */
export const LABEL_FONT_SIZES: Record<ShapeSize, number> = {
  s: 1.125,
  m: 1.375,
  l: 1.625,
  xl: 2,
};

/**
 * Advance widths as a fraction of the font size, approximating `tldraw_draw`.
 *
 * We cannot load the real font headlessly, so these were calibrated by measuring 104
 * real strings rendered in the browser at 22px and comparing against this table. The
 * safety factor covers the residual spread: with it, every measured string is
 * over-estimated (worst case ~0.99 of the estimate). Over-estimating only pads a shape
 * with whitespace; under-estimating spills text outside its box, so we bias upward.
 */
const NARROW_CHARS = new Set([...".,:;'`!|ijlItf()[]{}-"]);
const WIDE_CHARS = new Set([..."mwMW@%—"]);
const MID_CHARS = new Set([..."+=<>~*$&"]);
const SAFETY_FACTOR = 1.12;

const charWidth = (char: string): number => {
  if (char === " " || char === "\t") return 0.3;
  if (NARROW_CHARS.has(char)) return 0.33;
  if (WIDE_CHARS.has(char)) return 0.95;
  if (MID_CHARS.has(char)) return 0.62;
  if (/[A-Z0-9]/.test(char)) return 0.68;
  return 0.58;
};

/** Approximate rendered width of a single line, in px. */
export const measureLineWidth = (line: string, fontSize: number): number => {
  let em = 0;
  for (const char of line) em += charWidth(char);
  return em * fontSize * SAFETY_FACTOR;
};

/**
 * Greedy word wrap. Words wider than `maxWidth` are broken mid-word, matching the
 * `disableOverflowWrapBreaking: false` pass tldraw falls back to for long tokens.
 */
export const wrapLine = (line: string, fontSize: number, maxWidth: number): string[] => {
  if (line === "") return [""];

  const rows: string[] = [];
  let current = "";

  const pushBrokenWord = (word: string): void => {
    let chunk = "";
    for (const char of word) {
      if (chunk && measureLineWidth(chunk + char, fontSize) > maxWidth) {
        rows.push(chunk);
        chunk = char;
        continue;
      }
      chunk += char;
    }
    current = chunk;
  };

  for (const word of line.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureLineWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      rows.push(current);
      current = "";
    }
    if (measureLineWidth(word, fontSize) > maxWidth) {
      pushBrokenWord(word);
      continue;
    }
    current = word;
  }

  if (current) rows.push(current);
  return rows.length > 0 ? rows : [""];
};

export interface MeasuredLabel {
  /** Rendered height of the text block including padding, in px. */
  height: number;
  /** Widest rendered line including padding, in px. */
  width: number;
  /** Line count after wrapping. */
  lines: number;
}

/**
 * Measure a text label the way tldraw would: wrap to `maxWidth`, then
 * `lines * fontSize * lineHeight + padding * 2`.
 */
export const measureLabel = (
  text: string,
  options: { size?: ShapeSize; maxWidth: number; padding?: number } = { maxWidth: NOTE_SIZE },
): MeasuredLabel => {
  const size = options.size ?? "m";
  const padding = options.padding ?? LABEL_PADDING;
  const fontSize = THEME_FONT_SIZE * LABEL_FONT_SIZES[size];
  const innerWidth = Math.max(1, options.maxWidth - padding * 2 - 1);

  const rows = text.split("\n").flatMap((line) => wrapLine(line, fontSize, innerWidth));
  const widest = rows.reduce((max, row) => Math.max(max, measureLineWidth(row, fontSize)), 0);

  return {
    height: rows.length * fontSize * THEME_LINE_HEIGHT + padding * 2,
    width: widest + padding * 2,
    lines: rows.length,
  };
};

/**
 * `growY` for a note shape — the extra height tldraw would add for overflowing text.
 * Rounded up to whole pixels so repeated writes are stable.
 */
export const noteGrowY = (text: string, size: ShapeSize = "m"): number => {
  const { height } = measureLabel(text, { size, maxWidth: NOTE_SIZE });
  return Math.max(0, Math.ceil(height - NOTE_SIZE));
};

const INDEX_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Nth fractional-index key, in tldraw's `IndexKey` format.
 *
 * These are not plain base-36 counters: the leading letter encodes how many base-62
 * digits follow ('a' + 1 digit, 'b' + 2, and so on), so `a0`-`az` covers the first 62
 * shapes and `b00` takes over from there. Naive `a${n.toString(36)}` looks right until
 * the 36th shape, when it emits `a10` and tldraw refuses to load the whole file.
 */
export const indexKeyAt = (position: number): string => {
  let remaining = Math.max(0, Math.trunc(position));
  let head = 0;
  let capacity = 62;

  while (remaining >= capacity) {
    remaining -= capacity;
    head += 1;
    capacity *= 62;
  }

  let digits = "";
  let value = remaining;
  for (let i = 0; i <= head; i += 1) {
    digits = INDEX_DIGITS[value % 62] + digits;
    value = Math.floor(value / 62);
  }

  return String.fromCharCode(97 + head) + digits;
};

/** Full rendered height of a note, including growth. */
export const noteHeight = (text: string, size: ShapeSize = "m"): number =>
  NOTE_SIZE + noteGrowY(text, size);

/**
 * Height for a geo shape wide enough to hold `text` at `width`, with a sensible floor.
 * Geo shapes carry explicit `w`/`h`, so unlike notes we can size them exactly.
 */
export const geoHeight = (
  text: string,
  width: number,
  size: ShapeSize = "m",
  minHeight = 60,
): number => {
  const { height } = measureLabel(text, { size, maxWidth: width });
  return Math.max(minHeight, Math.ceil(height));
};
