import {
  imageMarkdownLine,
  parseImageMarkdownLine,
  toNoteAssetApiUrl,
  toNoteAssetMarkdownPath,
} from "../notes-assets/markdown.ts";

export interface BlocksToTextOptions {
  /**
   * GitHub-friendly markdown for gists / external publish.
   * Toggles become <details>/<summary>; DevHub ::directives are humanized or dropped.
   * Bold/italic/strike/code survive. textColor uses KaTeX $\color{…}$ (renders in gist /
   * README preview; HTML span/font color is stripped by GitHub).
   */
  portable?: boolean;
}

/** Serialize BlockNote blocks to DevHub round-trip markdown (or portable GitHub markdown). */
export function blocksToText(blocks: unknown[], options: BlocksToTextOptions = {}): string {
  if (options.portable === true) {
    return serializePortableBlocks(blocks);
  }
  return serializeRoundTripBlocks(blocks);
}

/** DevHub round-trip markdown (::toggle, ::task-ref, etc.). */
function serializeRoundTripBlocks(blocks: unknown[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const b = block as Record<string, unknown>;
    const props = b.props as Record<string, unknown> | undefined;

    if (b.type === "sharedChecklist") {
      const masterListId = typeof props?.masterListId === "string" ? props.masterListId.trim() : "";
      const entriesJson =
        typeof props?.entriesJson === "string" ? props.entriesJson.trim() : "[]";
      lines.push(
        masterListId
          ? `::shared-checklist ${masterListId} ${entriesJson}`
          : `::shared-checklist []`,
      );
    } else if (b.type === "taskRef") {
      const taskId = typeof props?.taskId === "string" ? props.taskId.trim() : "";
      const date = typeof props?.date === "string" ? props.date.trim() : "";
      const label = typeof props?.label === "string" ? props.label.trim() : "";
      lines.push(`::task-ref ${taskId} ${date} ${label}`.trimEnd());
    } else if (b.type === "diagramEmbed") {
      const path = typeof props?.path === "string" ? props.path.trim() : "";
      lines.push(`::diagram ${path}`.trimEnd());
    } else if (b.type === "collection") {
      const collectionId = typeof props?.collectionId === "string" ? props.collectionId.trim() : "";
      lines.push(collectionId ? `::collection ${collectionId}` : "::collection");
    } else if (b.type === "mermaid") {
      const code = typeof props?.code === "string" ? props.code : "";
      lines.push("```mermaid");
      lines.push(code);
      lines.push("```");
    } else if (b.type === "codeBlock") {
      const lang = (props?.language as string) || "";
      const inline = extractInline(b.content as Record<string, unknown>[] | undefined);
      lines.push("```" + lang);
      lines.push(inline);
      lines.push("```");
    } else if (b.type === "table") {
      lines.push(tableBlockToText(b));
    } else if (b.type === "divider") {
      lines.push("---");
    } else if (b.type === "image") {
      const caption = typeof props?.caption === "string" ? props.caption : "";
      const url = typeof props?.url === "string" ? props.url : "";
      lines.push(imageMarkdownLine(caption, toNoteAssetMarkdownPath(url)));
    } else if (b.type === "toggleListItem") {
      const summaryText = extractInline(b.content as Record<string, unknown>[] | undefined);
      const childMd =
        Array.isArray(b.children) && (b.children as unknown[]).length > 0
          ? serializeRoundTripBlocks(b.children as unknown[])
          : "";
      lines.push(`::toggle ${summaryText}`);
      if (childMd) lines.push(childMd);
      lines.push("::end-toggle");
      continue;
    } else {
      const prefix = blockPrefix(b.type as string, props);
      const inline = extractInline(b.content as Record<string, unknown>[] | undefined);
      lines.push(prefix + inline);
    }

    if (Array.isArray(b.children) && (b.children as unknown[]).length > 0) {
      const childText = serializeRoundTripBlocks(b.children as unknown[]);
      for (const line of childText.split("\n")) {
        lines.push("  " + line);
      }
    }
  }
  return lines.join("\n");
}

/**
 * GitHub-friendly publish markdown.
 *
 * Structural, not inferential: every block maps to one markdown construct based
 * on its *type*, never on the shape of its text or on what surrounds it. An
 * earlier version guessed intent — paragraphs inside a toggle became bullets, a
 * paragraph starting with "(" changed how the following paragraphs serialized —
 * which produced sensible output for the one note it was written against and
 * arbitrary output for everything else.
 *
 * The single semantic lift kept is: a paragraph whose text is *entirely* italic
 * renders as a blockquote. That rule is uniform (same result wherever the
 * paragraph appears) and reversible by removing the italics, so it stays
 * predictable. Want a bullet? Use a bullet. Want a quote? Italicise the line.
 */
function serializePortableBlocks(blocks: unknown[]): string {
  const chunks: string[] = [];

  const push = (chunk: string) => {
    if (!chunk) return;
    if (chunks.length > 0) chunks.push("");
    chunks.push(chunk);
  };

  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i] as Record<string, unknown>;
    const type = b.type as string;
    const props = b.props as Record<string, unknown> | undefined;
    const content = b.content as Record<string, unknown>[] | undefined;

    if (type === "sharedChecklist" || type === "collection") {
      push("*(shared checklist)*");
      i++;
      continue;
    }
    if (type === "taskRef") {
      const label = typeof props?.label === "string" ? props.label.trim() : "";
      if (label) push(`*Task: ${label}*`);
      i++;
      continue;
    }
    if (type === "diagramEmbed") {
      const path = typeof props?.path === "string" ? props.path.trim() : "";
      if (path) push(`*(diagram: ${path})*`);
      i++;
      continue;
    }
    if (type === "mermaid") {
      const code = typeof props?.code === "string" ? props.code : "";
      push("```mermaid\n" + code + "\n```");
      i++;
      continue;
    }
    if (type === "codeBlock") {
      const lang = (props?.language as string) || "";
      const inline = extractInline(content);
      push("```" + lang + "\n" + inline + "\n```");
      i++;
      continue;
    }
    if (type === "table") {
      push(tableBlockToText(b, { portable: true }));
      i++;
      continue;
    }
    if (type === "divider") {
      push("---");
      i++;
      continue;
    }
    if (type === "image") {
      const caption = typeof props?.caption === "string" ? props.caption : "";
      const url = typeof props?.url === "string" ? props.url : "";
      push(imageMarkdownLine(caption, toNoteAssetMarkdownPath(url)));
      i++;
      continue;
    }
    if (type === "toggleListItem") {
      const summaryText = extractInline(content, portableInlineOpts(props));
      const summary = summaryText.trim() || "Details";
      const childMd =
        Array.isArray(b.children) && (b.children as unknown[]).length > 0
          ? serializePortableBlocks(b.children as unknown[])
          : "";
      const parts = ["<details>", `<summary>${escapeHtmlText(summary)}</summary>`, ""];
      if (childMd) parts.push(childMd, "");
      parts.push("</details>");
      push(parts.join("\n"));
      i++;
      continue;
    }

    if (type === "bulletListItem" || type === "numberedListItem" || type === "checkListItem") {
      const listLines: string[] = [];
      while (i < blocks.length) {
        const item = blocks[i] as Record<string, unknown>;
        const itemType = item.type as string;
        if (
          itemType !== "bulletListItem" &&
          itemType !== "numberedListItem" &&
          itemType !== "checkListItem"
        ) {
          break;
        }
        const itemProps = item.props as Record<string, unknown> | undefined;
        const itemContent = item.content as Record<string, unknown>[] | undefined;
        listLines.push(
          blockPrefix(itemType, itemProps) + extractInline(itemContent, portableInlineOpts(itemProps)),
        );
        if (Array.isArray(item.children) && (item.children as unknown[]).length > 0) {
          const childText = serializePortableBlocks(item.children as unknown[]);
          for (const line of childText.split("\n")) {
            listLines.push(line === "" ? "" : "  " + line);
          }
        }
        i++;
      }
      push(listLines.join("\n"));
      continue;
    }

    if (type === "heading") {
      push(blockPrefix(type, props) + extractInline(content, portableInlineOpts(props)));
      i++;
      continue;
    }

    if (type === "paragraph") {
      const inline = extractInline(content, portableInlineOpts(props));
      if (!inline.trim()) {
        i++;
        continue;
      }
      push(isWhollyItalicContent(content) ? `> ${inline}` : inline);
      i++;
      appendChildChunks(b, push);
      continue;
    }

    const inline = extractInline(content, portableInlineOpts(props));
    if (inline.trim()) push(inline);
    i++;
    appendChildChunks(b, push);
  }

  return chunks.join("\n");
}

/**
 * Children of a non-list block become following siblings rather than indented
 * text. Indenting them would be worse than losing the nesting: two spaces does
 * nothing to a paragraph in CommonMark and four turns it into a code block.
 */
function appendChildChunks(block: Record<string, unknown>, push: (chunk: string) => void): void {
  const children = block.children;
  if (!Array.isArray(children) || children.length === 0) return;
  push(serializePortableBlocks(children as unknown[]));
}

function isWhollyItalicContent(content: Record<string, unknown>[] | undefined): boolean {
  return isWhollyStyled(content, "italic");
}

function isWhollyStyled(
  content: Record<string, unknown>[] | undefined,
  style: "italic" | "bold",
): boolean {
  if (!content || content.length === 0) return false;
  let sawText = false;
  for (const inline of content) {
    if (inline.type === "link") {
      if (!isWhollyStyled(inline.content as Record<string, unknown>[] | undefined, style)) {
        return false;
      }
      const plain = extractPlainText(inline.content as Record<string, unknown>[] | undefined);
      if (plain.trim()) sawText = true;
      continue;
    }
    const text = (inline.text as string) || "";
    if (!text.trim()) continue;
    sawText = true;
    const styles = inline.styles as Record<string, unknown> | undefined;
    if (!styles?.[style]) return false;
  }
  return sawText;
}

function extractPlainText(content: Record<string, unknown>[] | undefined): string {
  if (!content) return "";
  return content
    .map((inline) => {
      if (inline.type === "link") {
        return extractPlainText(inline.content as Record<string, unknown>[] | undefined);
      }
      return (inline.text as string) || "";
    })
    .join("");
}

/** Publish-oriented markdown (gists, external share). Same as blocksToText({ portable: true }). */
export function blocksToPortableMarkdown(blocks: unknown[]): string {
  return blocksToText(blocks, { portable: true });
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** BlockNote default text colors → hex (from @blocknote/core COLORS_DEFAULT). */
const BLOCKNOTE_TEXT_COLOR_HEX: Record<string, string> = {
  gray: "#9b9a97",
  brown: "#64473a",
  red: "#e03e3e",
  orange: "#d9730d",
  yellow: "#dfab01",
  green: "#4d6461",
  blue: "#0b6e99",
  purple: "#6940a5",
  pink: "#ad1a72",
};

interface ExtractInlineOptions {
  /** Emit KaTeX $\color{…}$ for textColor (gist/README safe; not for DevHub round-trip). */
  portable?: boolean;
  /** Block-level props.textColor applied when inline styles omit a color. */
  blockTextColor?: string;
}

function portableInlineOpts(props?: Record<string, unknown>): ExtractInlineOptions {
  const blockTextColor = typeof props?.textColor === "string" ? props.textColor : undefined;
  return { portable: true, blockTextColor };
}

function resolvePortableTextColor(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const key = name.trim();
  if (!key || key.toLowerCase() === "default") return null;
  if (/^#[0-9a-fA-F]{3,8}$/.test(key)) return key;
  return BLOCKNOTE_TEXT_COLOR_HEX[key.toLowerCase()] ?? null;
}

function escapeKatexText(text: string): string {
  return text.replace(/([\\#$%&_{}~^])/g, "\\$1");
}

/** Uniform textColor across link children (ignores default / missing). */
function uniformLinkTextColor(content: Record<string, unknown>[] | undefined): string | undefined {
  if (!content || content.length === 0) return undefined;
  let found: string | undefined;
  for (const inline of content) {
    if (inline.type === "link") {
      const nested = uniformLinkTextColor(inline.content as Record<string, unknown>[] | undefined);
      if (!nested) return undefined;
      if (found && found !== nested) return undefined;
      found = nested;
      continue;
    }
    const text = (inline.text as string) || "";
    if (!text.trim()) continue;
    const styles = inline.styles as Record<string, unknown> | undefined;
    const raw = typeof styles?.textColor === "string" ? styles.textColor : undefined;
    if (!raw || raw === "default") return undefined;
    if (found && found !== raw) return undefined;
    found = raw;
  }
  return found;
}

function formatPortableColoredPiece(piece: InlinePiece, color: string): string {
  const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(piece.text);
  const label = linkMatch ? linkMatch[1]! : piece.text;
  let inner = escapeKatexText(label);
  if (piece.bold && piece.italic) inner = `\\textbf{\\textit{${inner}}}`;
  else if (piece.bold) inner = `\\textbf{${inner}}`;
  else if (piece.italic) inner = `\\textit{${inner}}`;
  else inner = `\\textsf{${inner}}`;
  let colored = `$\\color{${color}}{${inner}}$`;
  if (piece.strike) colored = `~~${colored}~~`;
  if (linkMatch) return `[${colored}](${linkMatch[2]})`;
  return colored;
}

function blockPrefix(type: string, props?: Record<string, unknown>): string {
  switch (type) {
    case "heading": {
      const level = (props?.level as number) || 1;
      return "#".repeat(level) + " ";
    }
    case "bulletListItem":
      return "- ";
    case "numberedListItem":
      return "1. ";
    case "checkListItem":
      return props?.checked ? "- [x] " : "- [ ] ";
    default:
      return "";
  }
}

interface InlinePiece {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  textColor?: string;
}

/** Flatten inline nodes, merging adjacent runs with identical styles (fixes italic+link splits). */
function extractInline(
  content: Record<string, unknown>[] | undefined,
  opts: ExtractInlineOptions = {},
): string {
  if (!content) return "";

  const portable = opts.portable === true;
  const blockColor = resolvePortableTextColor(opts.blockTextColor);

  const pieces: InlinePiece[] = [];
  for (const inline of content) {
    if (inline.type === "link") {
      const linkParts = inline.content as Record<string, unknown>[] | undefined;
      const href = (inline.href as string) || "";
      const uniformItalic = isWhollyStyled(linkParts, "italic");
      const uniformBold = isWhollyStyled(linkParts, "bold");
      const linkColor = portable ? uniformLinkTextColor(linkParts) : undefined;
      if (uniformItalic || uniformBold || linkColor) {
        pieces.push({
          text: `[${extractPlainText(linkParts)}](${href})`,
          italic: uniformItalic || undefined,
          bold: uniformBold || undefined,
          textColor: linkColor,
        });
      } else {
        pieces.push({ text: `[${extractInline(linkParts, opts)}](${href})` });
      }
      continue;
    }
    const text = (inline.text as string) || "";
    const styles = inline.styles as Record<string, unknown> | undefined;
    const inlineColor =
      typeof styles?.textColor === "string" && styles.textColor !== "default"
        ? styles.textColor
        : undefined;
    pieces.push({
      text,
      bold: styles?.bold ? true : undefined,
      italic: styles?.italic ? true : undefined,
      strike: styles?.strike ? true : undefined,
      code: styles?.code ? true : undefined,
      textColor: inlineColor,
    });
  }

  const isMdLink = (piece: InlinePiece) => /^\[[^\]]*\]\([^)]*\)$/.test(piece.text);

  const merged: InlinePiece[] = [];
  for (const piece of pieces) {
    const prev = merged[merged.length - 1];
    // Don't merge a markdown link into adjacent text — KaTeX color wraps would
    // swallow [label](url) and escape characters inside the link.
    if (
      prev &&
      !prev.code &&
      !piece.code &&
      isMdLink(prev) === isMdLink(piece) &&
      Boolean(prev.bold) === Boolean(piece.bold) &&
      Boolean(prev.italic) === Boolean(piece.italic) &&
      Boolean(prev.strike) === Boolean(piece.strike) &&
      (prev.textColor || undefined) === (piece.textColor || undefined)
    ) {
      prev.text += piece.text;
    } else {
      merged.push({ ...piece });
    }
  }

  return merged
    .map((piece) => {
      const color =
        portable && !piece.code
          ? resolvePortableTextColor(piece.textColor) ?? blockColor
          : null;
      if (color) return formatPortableColoredPiece(piece, color);

      let result = piece.text;
      if (piece.code) result = `\`${result}\``;
      if (piece.bold && piece.italic) result = `***${result}***`;
      else if (piece.bold) result = `**${result}**`;
      else if (piece.italic) result = `*${result}*`;
      if (piece.strike) result = `~~${result}~~`;
      return result;
    })
    .join("");
}

function tableBlockToText(
  tableBlock: Record<string, unknown>,
  inlineOpts: ExtractInlineOptions = {},
): string {
  const content = tableBlock.content as Record<string, unknown> | undefined;
  if (!content || content.type !== "tableContent") return "";

  const rows = content.rows as Record<string, unknown>[] | undefined;
  if (!rows || rows.length === 0) return "";

  const mdRows: string[] = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] as Record<string, unknown>;
    const cells = row.cells as Record<string, unknown>[][] | undefined;
    if (!cells) continue;

    const cellTexts = cells.map((cellParts) => {
      if (Array.isArray(cellParts)) {
        return extractInline(cellParts as Record<string, unknown>[], inlineOpts).replace(/\|/g, "\\|");
      }
      const tc = cellParts as Record<string, unknown>;
      const tcContent = tc.content as Record<string, unknown>[] | undefined;
      if (tcContent) {
        return extractInline(tcContent, inlineOpts).replace(/\|/g, "\\|");
      }
      return " ";
    });

    mdRows.push("| " + cellTexts.join(" | ") + " |");

    if (r === 0) {
      mdRows.push("| " + cellTexts.map(() => "---").join(" | ") + " |");
    }
  }

  return mdRows.join("\n");
}

interface InlineSegment {
  type: string;
  text?: string;
  href?: string;
  content?: InlineSegment[];
  styles: Record<string, boolean>;
}

const INLINE_RE =
  /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;

function parseInline(text: string): InlineSegment[] {
  const parts: InlineSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_RE.lastIndex = 0;

  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        text: text.slice(lastIndex, match.index),
        styles: {},
      });
    }

    if (match[2] !== undefined) {
      parts.push({
        type: "text",
        text: match[2],
        styles: { bold: true, italic: true },
      });
    } else if (match[3] !== undefined) {
      parts.push({
        type: "text",
        text: match[3],
        styles: { bold: true },
      });
    } else if (match[4] !== undefined) {
      parts.push({
        type: "text",
        text: match[4],
        styles: { italic: true },
      });
    } else if (match[5] !== undefined) {
      parts.push({
        type: "text",
        text: match[5],
        styles: { strike: true },
      });
    } else if (match[6] !== undefined) {
      parts.push({
        type: "text",
        text: match[6],
        styles: { code: true },
      });
    } else if (match[7] !== undefined && match[8] !== undefined) {
      parts.push({
        type: "link",
        href: match[8],
        styles: {},
        content: [{ type: "text", text: match[7], styles: {} }],
      });
    }

    lastIndex = INLINE_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({
      type: "text",
      text: text.slice(lastIndex),
      styles: {},
    });
  }

  return parts.length > 0 ? parts : [{ type: "text", text, styles: {} }];
}

function parseTable(rows: string[]): Record<string, unknown> {
  const dataRows = rows.filter((r) => !r.trim().match(/^\|[\s\-:|]+\|$/));

  const tableRows = dataRows.map((row) => {
    const cells = row
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

    return {
      cells: cells.map((cellText) => parseInline(cellText)),
    };
  });

  return {
    id: crypto.randomUUID(),
    type: "table",
    props: { textColor: "default", backgroundColor: "default" },
    content: {
      type: "tableContent",
      columnWidths:
        dataRows[0]
          ?.split("|")
          .slice(1, -1)
          .map(() => undefined) ?? [],
      rows: tableRows,
    },
    children: [],
  };
}

export function textToBlocks(text: string): unknown[] {
  const lines = text.split("\n");
  const blocks: unknown[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      if (lang === "mermaid") {
        blocks.push({
          id: crypto.randomUUID(),
          type: "mermaid",
          props: { code: codeLines.join("\n") },
          children: [],
        });
        continue;
      }
      blocks.push({
        id: crypto.randomUUID(),
        type: "codeBlock",
        props: {
          language: lang || "plaintext",
          textColor: "default",
          backgroundColor: "default",
          textAlignment: "left",
        },
        content: [{ type: "text", text: codeLines.join("\n"), styles: {} }],
        children: [],
      });
      continue;
    }

    const taskRefMatch = trimmed.match(/^::task-ref\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
    if (taskRefMatch) {
      blocks.push({
        id: crypto.randomUUID(),
        type: "taskRef",
        props: {
          taskId: taskRefMatch[1],
          date: taskRefMatch[2],
          label: taskRefMatch[3]?.trim() ?? "",
        },
        children: [],
      });
      i++;
      continue;
    }

    const diagramMatch = trimmed.match(/^::diagram(?:\s+(.+))?$/);
    if (diagramMatch) {
      blocks.push({
        id: crypto.randomUUID(),
        type: "diagramEmbed",
        props: { path: diagramMatch[1]?.trim() ?? "" },
        children: [],
      });
      i++;
      continue;
    }

    const sharedChecklistMatch = trimmed.match(/^::shared-checklist(?:\s+([^\s]+)(?:\s+(\[.*\]))?)?$/);
    if (sharedChecklistMatch) {
      blocks.push({
        id: crypto.randomUUID(),
        type: "sharedChecklist",
        props: {
          masterListId: sharedChecklistMatch[1]?.trim() ?? "",
          entriesJson: sharedChecklistMatch[2]?.trim() ?? "[]",
        },
        children: [],
      });
      i++;
      continue;
    }

    const toggleMatch = trimmed.match(/^::toggle(?:\s+(.+))?$/);
    if (toggleMatch) {
      const title = toggleMatch[1]?.trim() ?? "Details";
      const childLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "::end-toggle") {
        childLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim() === "::end-toggle") {
        i++;
      }
      blocks.push({
        id: crypto.randomUUID(),
        type: "toggleListItem",
        props: {
          textColor: "default",
          backgroundColor: "default",
          textAlignment: "left",
        },
        content: parseInline(title),
        children: childLines.length > 0 ? textToBlocks(childLines.join("\n")) : [],
      });
      continue;
    }

    const collectionMatch = trimmed.match(/^::collection(?:\s+(.+))?$/);
    if (collectionMatch) {
      blocks.push({
        id: crypto.randomUUID(),
        type: "sharedChecklist",
        props: {
          masterListId: collectionMatch[1]?.trim() ?? "",
          entriesJson: "[]",
        },
        children: [],
      });
      i++;
      continue;
    }

    const imageLine = parseImageMarkdownLine(trimmed);
    if (imageLine) {
      const notesPath = toNoteAssetMarkdownPath(imageLine.path);
      blocks.push({
        id: crypto.randomUUID(),
        type: "image",
        props: {
          textAlignment: "left",
          backgroundColor: "default",
          name: notesPath.split("/").pop() ?? "",
          url: toNoteAssetApiUrl(notesPath),
          caption: imageLine.caption,
          showPreview: true,
        },
        children: [],
      });
      i++;
      continue;
    }

    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      blocks.push({
        id: crypto.randomUUID(),
        type: "divider",
        props: { textColor: "default", backgroundColor: "default" },
        children: [],
      });
      i++;
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableRows: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim().startsWith("|") &&
        lines[i].trim().endsWith("|")
      ) {
        tableRows.push(lines[i].trim());
        i++;
      }
      if (tableRows.length >= 2) {
        blocks.push(parseTable(tableRows));
      } else {
        blocks.push(makeBlock("paragraph", trimmed));
        i++;
      }
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(makeBlock("heading", trimmed.slice(4), { level: 3 }));
    } else if (trimmed.startsWith("## ")) {
      blocks.push(makeBlock("heading", trimmed.slice(3), { level: 2 }));
    } else if (trimmed.startsWith("# ")) {
      blocks.push(makeBlock("heading", trimmed.slice(2), { level: 1 }));
    } else if (trimmed.startsWith("- [x] ") || trimmed.startsWith("- [ ] ")) {
      const checked = trimmed.startsWith("- [x] ");
      blocks.push(makeBlock("checkListItem", trimmed.slice(6), { checked }));
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      blocks.push(makeBlock("bulletListItem", trimmed.slice(2)));
    } else if (/^\d+\.\s/.test(trimmed)) {
      blocks.push(makeBlock("numberedListItem", trimmed.replace(/^\d+\.\s/, "")));
    } else {
      blocks.push(makeBlock("paragraph", trimmed));
    }
    i++;
  }

  if (blocks.length === 0) {
    blocks.push(makeBlock("paragraph", ""));
  }
  return blocks;
}

function makeBlock(
  type: string,
  text: string,
  extra?: Record<string, unknown>,
): unknown {
  return {
    id: crypto.randomUUID(),
    type,
    props: {
      textColor: "default",
      backgroundColor: "default",
      textAlignment: "left",
      ...extra,
    },
    content: parseInline(text),
    children: [],
  };
}
