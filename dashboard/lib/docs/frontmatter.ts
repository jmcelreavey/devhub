/**
 * Minimal YAML frontmatter for docs.
 *
 * Deliberately not a YAML parser. Docs frontmatter is a closed set of fields we
 * author ourselves, so this supports exactly the shapes we use — scalars, inline
 * arrays, and block arrays — and nothing else. Anything more exotic is a sign
 * the doc is trying to be a database.
 */

export interface DocFrontmatter {
  title?: string;
  description?: string;
  /** Nav section id; falls back to the top-level folder when absent. */
  section?: string;
  /** Sort weight within a section. Lower sorts first; unset sorts last. */
  order?: number;
  tags?: string[];
  /** Hand-curated outbound links, as doc slugs or relative .md paths. */
  related?: string[];
  /** Hide from nav and landing page without deleting the file. */
  draft?: boolean;
  /** Icon name (lucide) for landing-page cards. */
  icon?: string;
}

export interface ParsedDoc {
  frontmatter: DocFrontmatter;
  /** Markdown body with the frontmatter block removed. */
  body: string;
  /** True when the source actually had a frontmatter block. */
  hasFrontmatter: boolean;
}

const FENCE = /^---[ \t]*\r?\n/;

function stripQuotes(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function splitInlineArray(raw: string): string[] {
  const inner = raw.trim().slice(1, -1);
  if (!inner.trim()) return [];
  return inner
    .split(",")
    .map((part) => stripQuotes(part))
    .filter((part) => part.length > 0);
}

function coerceScalar(raw: string): string | number | boolean {
  const value = stripQuotes(raw);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

function assignField(
  target: Record<string, unknown>,
  key: string,
  value: string | number | boolean | string[],
): void {
  target[key] = value;
}

/**
 * Split a document into frontmatter and body.
 *
 * Returns `hasFrontmatter: false` (and the untouched source as `body`) when the
 * file has no leading `---` block, so callers can tell "no metadata" apart from
 * "empty metadata".
 */
export function parseFrontmatter(source: string): ParsedDoc {
  const normalized = source.replace(/^﻿/, "");
  if (!FENCE.test(normalized)) {
    return { frontmatter: {}, body: normalized, hasFrontmatter: false };
  }

  const lines = normalized.split(/\r?\n/);
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---[ \t]*$/.test(lines[i])) {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) {
    // Unterminated block — treat the whole file as body rather than silently
    // swallowing content into metadata.
    return { frontmatter: {}, body: normalized, hasFrontmatter: false };
  }

  const raw: Record<string, unknown> = {};
  let pendingKey: string | null = null;
  let pendingList: string[] = [];

  const flushList = () => {
    if (pendingKey) assignField(raw, pendingKey, pendingList);
    pendingKey = null;
    pendingList = [];
  };

  for (let i = 1; i < closingIndex; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const listMatch = /^[ \t]*-[ \t]+(.*)$/.exec(line);
    if (listMatch && pendingKey) {
      const item = stripQuotes(listMatch[1]);
      if (item) pendingList.push(item);
      continue;
    }

    const kvMatch = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!kvMatch) continue;

    flushList();
    const [, key, rest] = kvMatch;
    const value = rest.trim();

    if (value === "") {
      // Either a block array follows, or the field is empty. Buffer and decide
      // when we see the next line.
      pendingKey = key;
      pendingList = [];
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      assignField(raw, key, splitInlineArray(value));
      continue;
    }
    assignField(raw, key, coerceScalar(value));
  }
  flushList();

  return {
    frontmatter: normalizeFrontmatter(raw),
    body: lines.slice(closingIndex + 1).join("\n").replace(/^\s*\n/, ""),
    hasFrontmatter: true,
  };
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((v) => asString(v)).filter((v): v is string => Boolean(v));
    return items.length > 0 ? items : undefined;
  }
  const single = asString(value);
  return single ? [single] : undefined;
}

/** Narrow loosely-typed parse output onto the DocFrontmatter shape. */
export function normalizeFrontmatter(raw: Record<string, unknown>): DocFrontmatter {
  const out: DocFrontmatter = {};
  const title = asString(raw.title);
  if (title) out.title = title;
  const description = asString(raw.description);
  if (description) out.description = description;
  const section = asString(raw.section);
  if (section) out.section = section;
  if (typeof raw.order === "number" && Number.isFinite(raw.order)) out.order = raw.order;
  const tags = asStringArray(raw.tags);
  if (tags) out.tags = tags;
  const related = asStringArray(raw.related);
  if (related) out.related = related;
  if (raw.draft === true) out.draft = true;
  const icon = asString(raw.icon);
  if (icon) out.icon = icon;
  return out;
}

function serializeValue(value: string): string {
  // Quote anything that would confuse the parser on the way back in.
  if (/^[\s]|[\s]$|^[[{>|*&!%@`]|: |#/.test(value) || value === "") {
    return JSON.stringify(value);
  }
  return value;
}

/** Render frontmatter back to a `---` block. Returns "" for empty metadata. */
export function serializeFrontmatter(fm: DocFrontmatter): string {
  const lines: string[] = [];
  if (fm.title) lines.push(`title: ${serializeValue(fm.title)}`);
  if (fm.description) lines.push(`description: ${serializeValue(fm.description)}`);
  if (fm.section) lines.push(`section: ${serializeValue(fm.section)}`);
  if (typeof fm.order === "number") lines.push(`order: ${fm.order}`);
  if (fm.icon) lines.push(`icon: ${serializeValue(fm.icon)}`);
  if (fm.tags?.length) lines.push(`tags: [${fm.tags.join(", ")}]`);
  if (fm.draft) lines.push("draft: true");
  if (fm.related?.length) {
    lines.push("related:");
    for (const item of fm.related) lines.push(`  - ${serializeValue(item)}`);
  }
  if (lines.length === 0) return "";
  return `---\n${lines.join("\n")}\n---\n`;
}

/**
 * Split off the frontmatter block *verbatim*, without reserialising it.
 *
 * The editor round-trip needs this: `parseFrontmatter` drops keys it does not
 * model, so re-emitting from the parsed object would silently delete anything
 * hand-written. Keeping the raw text means an edit can only ever change the
 * body.
 */
export function splitFrontmatterBlock(source: string): { block: string; body: string } {
  const normalized = source.replace(/^﻿/, "");
  if (!FENCE.test(normalized)) return { block: "", body: normalized };
  const lines = normalized.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---[ \t]*$/.test(lines[i])) {
      return {
        block: `${lines.slice(0, i + 1).join("\n")}\n`,
        body: lines.slice(i + 1).join("\n").replace(/^\s*\n/, ""),
      };
    }
  }
  return { block: "", body: normalized };
}

/** Replace (or insert) the frontmatter block on a markdown source string. */
export function withFrontmatter(source: string, fm: DocFrontmatter): string {
  const { body } = parseFrontmatter(source);
  const block = serializeFrontmatter(fm);
  return block ? `${block}\n${body}` : body;
}
