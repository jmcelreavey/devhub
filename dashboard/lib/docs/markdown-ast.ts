/**
 * Markdown -> typed AST for the docs read view.
 *
 * We already have `shared/markdown-convert` for round-tripping markdown through
 * BlockNote, but that AST is shaped for an editor: it has no heading anchors, no
 * callouts, and folds structure we need for a table of contents. This module is
 * the read-side counterpart — parse once on the server, render as React.
 *
 * Scope is GitHub-flavoured markdown minus the bits our docs do not use. Raw
 * HTML is escaped rather than passed through: docs are locally editable, and a
 * docs page is not worth an HTML injection surface.
 */

export type CalloutVariant = "note" | "tip" | "important" | "warning" | "caution";

export interface InlineStyles {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
}

export type InlineNode =
  | { type: "text"; value: string; styles: InlineStyles }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "image"; src: string; alt: string };

export interface ListItemNode {
  content: InlineNode[];
  /** Present only for task-list items. */
  checked?: boolean;
  children: DocNode[];
}

export type DocNode =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; id: string; text: string; content: InlineNode[] }
  | { type: "paragraph"; content: InlineNode[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItemNode[] }
  | { type: "code"; lang: string; value: string }
  | { type: "mermaid"; code: string }
  | { type: "blockquote"; children: DocNode[] }
  | { type: "callout"; variant: CalloutVariant; title?: string; children: DocNode[] }
  | { type: "table"; align: Array<"left" | "center" | "right" | null>; header: InlineNode[][]; rows: InlineNode[][][] }
  | { type: "image"; src: string; alt: string }
  | { type: "divider" };

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface DocOutboundLink {
  href: string;
  text: string;
}

export interface ParsedMarkdown {
  nodes: DocNode[];
  toc: TocEntry[];
  /** First heading in the document, useful as a title fallback. */
  firstHeading: string | null;
  /** All link hrefs found anywhere in the document, in source order. */
  links: DocOutboundLink[];
}

/* ------------------------------------------------------------------ inline */

const ESCAPABLE = new Set([
  "\\", "`", "*", "_", "{", "}", "[", "]", "(", ")", "#", "+", "-", ".", "!", "|", "~", ">",
]);

function pushText(out: InlineNode[], value: string, styles: InlineStyles): void {
  if (!value) return;
  const last = out[out.length - 1];
  if (last && last.type === "text" && sameStyles(last.styles, styles)) {
    last.value += value;
    return;
  }
  out.push({ type: "text", value, styles: { ...styles } });
}

function sameStyles(a: InlineStyles, b: InlineStyles): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.code) === Boolean(b.code) &&
    Boolean(a.strike) === Boolean(b.strike)
  );
}

/**
 * Read a bracketed span starting at `open`, honouring nesting and escapes.
 * Returns the index just past the closing bracket, or -1.
 */
function matchDelimited(src: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function parseInline(src: string, styles: InlineStyles = {}): InlineNode[] {
  const out: InlineNode[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    pushText(out, buffer, styles);
    buffer = "";
  };

  while (i < src.length) {
    const ch = src[i];

    // Escapes.
    if (ch === "\\" && i + 1 < src.length && ESCAPABLE.has(src[i + 1])) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }

    // Inline code — highest precedence, no nested parsing.
    if (ch === "`") {
      let fenceLen = 0;
      while (src[i + fenceLen] === "`") fenceLen += 1;
      const fence = "`".repeat(fenceLen);
      const close = src.indexOf(fence, i + fenceLen);
      if (close !== -1) {
        flush();
        const value = src.slice(i + fenceLen, close);
        pushText(out, value.replace(/^ (.*) $/, "$1"), { ...styles, code: true });
        i = close + fenceLen;
        continue;
      }
    }

    // Image.
    if (ch === "!" && src[i + 1] === "[") {
      const altEnd = matchDelimited(src, i + 1, "[", "]");
      if (altEnd !== -1 && src[altEnd] === "(") {
        const hrefEnd = matchDelimited(src, altEnd, "(", ")");
        if (hrefEnd !== -1) {
          flush();
          out.push({
            type: "image",
            alt: src.slice(i + 2, altEnd - 1),
            src: cleanHref(src.slice(altEnd + 1, hrefEnd - 1)),
          });
          i = hrefEnd;
          continue;
        }
      }
    }

    // Link.
    if (ch === "[") {
      const textEnd = matchDelimited(src, i, "[", "]");
      if (textEnd !== -1 && src[textEnd] === "(") {
        const hrefEnd = matchDelimited(src, textEnd, "(", ")");
        if (hrefEnd !== -1) {
          flush();
          out.push({
            type: "link",
            href: cleanHref(src.slice(textEnd + 1, hrefEnd - 1)),
            children: parseInline(src.slice(i + 1, textEnd - 1), styles),
          });
          i = hrefEnd;
          continue;
        }
      }
    }

    // Bare autolink: <https://…>
    if (ch === "<") {
      const close = src.indexOf(">", i);
      if (close !== -1) {
        const inner = src.slice(i + 1, close);
        if (/^(https?:\/\/|mailto:)\S+$/.test(inner)) {
          flush();
          out.push({ type: "link", href: inner, children: [{ type: "text", value: inner, styles: { ...styles } }] });
          i = close + 1;
          continue;
        }
      }
    }

    // Strikethrough.
    if (ch === "~" && src[i + 1] === "~" && !styles.strike) {
      const close = src.indexOf("~~", i + 2);
      if (close !== -1) {
        flush();
        out.push(...parseInline(src.slice(i + 2, close), { ...styles, strike: true }));
        i = close + 2;
        continue;
      }
    }

    // Emphasis. Longest run first so *** resolves to bold+italic.
    if (ch === "*" || ch === "_") {
      const runLen = ch === src[i + 2] ? 3 : ch === src[i + 1] ? 2 : 1;
      const marker = ch.repeat(runLen);
      const close = findEmphasisClose(src, i + runLen, marker);
      if (close !== -1) {
        const nested: InlineStyles = { ...styles };
        if (runLen >= 2) nested.bold = true;
        if (runLen === 1 || runLen === 3) nested.italic = true;
        if (!(styles.bold && nested.bold && styles.italic && nested.italic)) {
          flush();
          out.push(...parseInline(src.slice(i + runLen, close), nested));
          i = close + runLen;
          continue;
        }
      }
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return out;
}

function findEmphasisClose(src: string, from: number, marker: string): number {
  for (let i = from; i <= src.length - marker.length; i += 1) {
    if (src[i] === "\\") {
      i += 1;
      continue;
    }
    if (src.startsWith(marker, i)) {
      // Reject an immediately-empty span (`**` `**`).
      if (i === from) return -1;
      return i;
    }
  }
  return -1;
}

function cleanHref(raw: string): string {
  const trimmed = raw.trim();
  // Drop an optional markdown title: [x](/y "Title")
  const withoutTitle = trimmed.replace(/\s+["'(].*["')]$/, "");
  return withoutTitle.replace(/^<|>$/g, "");
}

export function inlineToPlainText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.value;
      if (node.type === "link") return inlineToPlainText(node.children);
      return node.alt;
    })
    .join("");
}

/* -------------------------------------------------------------------- slug */

/**
 * GitHub-compatible heading slug.
 *
 * Matches GitHub's algorithm deliberately, including the bit that looks like a
 * bug: consecutive hyphens are *not* collapsed, so "Tier 3 — branding" becomes
 * `tier-3--branding`. Docs are read both in-app and on GitHub, and an anchor
 * that only works in one of them is worse than no anchor.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ------------------------------------------------------------------ blocks */

const CALLOUT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;

interface BlockContext {
  usedSlugs: Map<string, number>;
}

function uniqueSlug(ctx: BlockContext, text: string): string {
  const base = slugify(text) || "section";
  const seen = ctx.usedSlugs.get(base) ?? 0;
  ctx.usedSlugs.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

function stripHtml(line: string): string {
  const code: string[] = [];
  const protectedLine = line.replace(/(`+)([\s\S]*?)\1/g, (match) => {
    code.push(match);
    return `\0${code.length - 1}\0`;
  });
  return protectedLine
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\0(\d+)\0/g, (_, index: string) => code[Number(index)] ?? "");
}

function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

function parseBlocks(lines: string[], ctx: BlockContext): DocNode[] {
  const nodes: DocNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code / mermaid.
    const fence = /^([ \t]*)(```+|~~~+)[ \t]*([A-Za-z0-9_+-]*)[ \t]*$/.exec(line);
    if (fence) {
      const [, , marker, lang] = fence;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^[ \\t]*${marker[0]}{${marker.length},}[ \\t]*$`).test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      const value = body.join("\n");
      nodes.push(
        lang.toLowerCase() === "mermaid"
          ? { type: "mermaid", code: value }
          : { type: "code", lang: lang.toLowerCase(), value },
      );
      continue;
    }

    // ATX heading.
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const content = parseInline(stripHtml(heading[2]));
      const text = inlineToPlainText(content);
      nodes.push({ type: "heading", level, id: uniqueSlug(ctx, text), text, content });
      i += 1;
      continue;
    }

    // Thematic break. Checked before lists so `---` isn't read as a bullet.
    if (/^([*_-])(\s*\1){2,}$/.test(trimmed)) {
      nodes.push({ type: "divider" });
      i += 1;
      continue;
    }

    // Blockquote / callout.
    if (trimmed.startsWith(">")) {
      const quoted: string[] = [];
      while (i < lines.length && (lines[i].trim().startsWith(">") || (quoted.length > 0 && lines[i].trim()))) {
        if (!lines[i].trim().startsWith(">")) break;
        quoted.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      const calloutMatch = quoted.length > 0 ? CALLOUT_RE.exec(quoted[0].trim()) : null;
      if (calloutMatch) {
        const variant = calloutMatch[1].toLowerCase() as CalloutVariant;
        const inlineTitle = calloutMatch[2].trim();
        nodes.push({
          type: "callout",
          variant,
          title: inlineTitle || undefined,
          children: parseBlocks(quoted.slice(1), ctx),
        });
      } else {
        nodes.push({ type: "blockquote", children: parseBlocks(quoted, ctx) });
      }
      continue;
    }

    // Table (GFM): header row followed by a delimiter row.
    if (trimmed.includes("|") && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      const header = splitTableRow(trimmed).map((cell) => parseInline(cell));
      const align = parseTableAlign(lines[i + 1]);
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim()) {
        rows.push(splitTableRow(lines[i].trim()).map((cell) => parseInline(cell)));
        i += 1;
      }
      nodes.push({ type: "table", align, header, rows });
      continue;
    }

    // Lists.
    const listMatch = matchListMarker(line);
    if (listMatch) {
      const { node, next } = parseList(lines, i, ctx);
      nodes.push(node);
      i = next;
      continue;
    }

    // Standalone image paragraph gets its own figure treatment.
    const loneImage = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (loneImage) {
      nodes.push({ type: "image", alt: loneImage[1], src: cleanHref(loneImage[2]) });
      i += 1;
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i];
      if (!current.trim()) break;
      if (paragraph.length > 0 && startsNewBlock(lines, i)) break;
      paragraph.push(stripHtml(current).trim());
      i += 1;
    }
    const text = paragraph.join("\n").trim();
    if (text) nodes.push({ type: "paragraph", content: parseInline(text) });
  }

  return nodes;
}

function startsNewBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  const trimmed = line.trim();
  if (/^(#{1,6})\s/.test(trimmed)) return true;
  if (/^([*_-])(\s*\1){2,}$/.test(trimmed)) return true;
  if (/^(```+|~~~+)/.test(trimmed)) return true;
  if (trimmed.startsWith(">")) return true;
  if (matchListMarker(line)) return true;
  if (trimmed.includes("|") && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) return true;
  return false;
}

interface ListMarker {
  indent: number;
  ordered: boolean;
  start: number;
  checked?: boolean;
  text: string;
  contentIndent: number;
}

function matchListMarker(line: string): ListMarker | null {
  const match = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/.exec(line);
  if (!match) return null;
  const [, lead, marker, rest] = match;
  const ordered = /\d/.test(marker);
  const task = /^\[([ xX])\][ \t]+(.*)$/.exec(rest);
  return {
    indent: indentWidth(lead),
    ordered,
    start: ordered ? Number.parseInt(marker, 10) : 1,
    checked: task ? task[1].toLowerCase() === "x" : undefined,
    text: task ? task[2] : rest,
    contentIndent: indentWidth(lead) + marker.length + 1,
  };
}

function parseList(
  lines: string[],
  startIndex: number,
  ctx: BlockContext,
): { node: DocNode; next: number } {
  const first = matchListMarker(lines[startIndex]);
  if (!first) throw new Error("parseList called on a non-list line");
  const baseIndent = first.indent;
  const items: ListItemNode[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const marker = matchListMarker(lines[i]);
    if (!marker || marker.indent < baseIndent) break;
    if (marker.indent > baseIndent) break; // handled as a child below
    if (marker.ordered !== first.ordered) break;

    const childLines: string[] = [];
    i += 1;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        // Keep blank lines only if the list continues afterwards.
        const nextNonBlank = lines.findIndex((l, idx) => idx > i && l.trim());
        if (nextNonBlank === -1) break;
        if (indentWidth(lines[nextNonBlank]) <= baseIndent && matchListMarker(lines[nextNonBlank])) {
          childLines.push("");
          i += 1;
          continue;
        }
        if (indentWidth(lines[nextNonBlank]) <= baseIndent) break;
        childLines.push("");
        i += 1;
        continue;
      }
      const nested = matchListMarker(line);
      if (nested && nested.indent <= baseIndent) break;
      if (!nested && indentWidth(line) <= baseIndent) break;
      childLines.push(line.slice(Math.min(indentWidth(line), marker.contentIndent)));
      i += 1;
    }

    items.push({
      content: parseInline(stripHtml(marker.text).trim()),
      checked: marker.checked,
      children: childLines.some((l) => l.trim()) ? parseBlocks(childLines, ctx) : [],
    });
  }

  return {
    node: { type: "list", ordered: first.ordered, start: first.start, items },
    next: i,
  };
}

function isTableDelimiter(line: string | undefined): boolean {
  if (!line) return false;
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return false;
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(trimmed);
}

function splitTableRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let buffer = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      buffer += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  cells.push(buffer.trim());
  return cells;
}

function parseTableAlign(line: string): Array<"left" | "center" | "right" | null> {
  return splitTableRow(line).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

/* ------------------------------------------------------------------ public */

function collectLinks(nodes: DocNode[], out: DocOutboundLink[]): void {
  const walkInline = (inlines: InlineNode[]) => {
    for (const node of inlines) {
      if (node.type === "link") {
        out.push({ href: node.href, text: inlineToPlainText(node.children) });
        walkInline(node.children);
      }
    }
  };
  for (const node of nodes) {
    switch (node.type) {
      case "heading":
      case "paragraph":
        walkInline(node.content);
        break;
      case "list":
        for (const item of node.items) {
          walkInline(item.content);
          collectLinks(item.children, out);
        }
        break;
      case "blockquote":
      case "callout":
        collectLinks(node.children, out);
        break;
      case "table":
        for (const cell of node.header) walkInline(cell);
        for (const row of node.rows) for (const cell of row) walkInline(cell);
        break;
      default:
        break;
    }
  }
}

/** Parse a markdown body (frontmatter already stripped) into a render tree. */
export function parseMarkdown(body: string): ParsedMarkdown {
  const ctx: BlockContext = { usedSlugs: new Map() };
  const nodes = parseBlocks(body.replace(/\r\n/g, "\n").split("\n"), ctx);

  const toc: TocEntry[] = [];
  let firstHeading: string | null = null;
  for (const node of nodes) {
    if (node.type !== "heading") continue;
    if (firstHeading === null) firstHeading = node.text;
    if (node.level === 2 || node.level === 3) {
      toc.push({ id: node.id, text: node.text, level: node.level });
    }
  }

  const links: DocOutboundLink[] = [];
  collectLinks(nodes, links);

  return { nodes, toc, firstHeading, links };
}
