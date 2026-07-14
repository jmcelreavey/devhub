import {
  imageMarkdownLine,
  parseImageMarkdownLine,
  toNoteAssetApiUrl,
  toNoteAssetMarkdownPath,
} from "../notes-assets/markdown.ts";

export function blocksToText(blocks: unknown[]): string {
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
      const label = typeof props?.label === "string" ? props.label : "";
      lines.push(`::task-ref ${taskId} ${date} ${label}`.trimEnd());
    } else if (b.type === "diagramEmbed") {
      const path = typeof props?.path === "string" ? props.path.trim() : "";
      lines.push(`::diagram ${path}`.trimEnd());
    } else if (b.type === "mermaid") {
      const code = typeof props?.code === "string" ? props.code : "";
      lines.push("```mermaid");
      lines.push(code);
      lines.push("```");
    } else if (b.type === "collection") {
      const collectionId = typeof props?.collectionId === "string" ? props.collectionId.trim() : "";
      lines.push(collectionId ? `::collection ${collectionId}` : "::collection");
    } else if (b.type === "codeBlock") {
      const lang = (props?.language as string) || "";
      const text = extractInline(b.content as Record<string, unknown>[] | undefined);
      lines.push("```" + lang);
      lines.push(text);
      lines.push("```");
    } else if (b.type === "table") {
      const tableText = tableBlockToText(b);
      lines.push(tableText);
    } else if (b.type === "divider") {
      lines.push("---");
    } else if (b.type === "image") {
      const caption = typeof props?.caption === "string" ? props.caption : "";
      const url = typeof props?.url === "string" ? props.url : "";
      lines.push(imageMarkdownLine(caption, toNoteAssetMarkdownPath(url)));
    } else if (b.type === "toggleListItem") {
      const text = extractInline(b.content as Record<string, unknown>[] | undefined);
      lines.push(`::toggle ${text}`);
      if (Array.isArray(b.children) && (b.children as unknown[]).length > 0) {
        lines.push(blocksToText(b.children as unknown[]));
      }
      lines.push("::end-toggle");
      continue;
    } else {
      const prefix = blockPrefix(b.type as string, props);
      const text = extractInline(b.content as Record<string, unknown>[] | undefined);
      lines.push(prefix + text);
    }

    if (Array.isArray(b.children) && (b.children as unknown[]).length > 0) {
      const childText = blocksToText(b.children as unknown[]);
      for (const line of childText.split("\n")) {
        lines.push("  " + line);
      }
    }
  }
  return lines.join("\n");
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

function extractInline(content: Record<string, unknown>[] | undefined): string {
  if (!content) return "";
  return content
    .map((inline) => {
      if (inline.type === "link") {
        const linkContent = extractInline(
          inline.content as Record<string, unknown>[] | undefined,
        );
        const href = (inline.href as string) || "";
        return `[${linkContent}](${href})`;
      }
      const text = (inline.text as string) || "";
      const styles = inline.styles as Record<string, unknown> | undefined;
      let result = text;
      if (styles?.bold && styles?.italic) result = `***${result}***`;
      else if (styles?.bold) result = `**${result}**`;
      else if (styles?.italic) result = `*${result}*`;
      if (styles?.strike) result = `~~${result}~~`;
      if (styles?.code) result = `\`${result}\``;
      return result;
    })
    .join("");
}

function tableBlockToText(tableBlock: Record<string, unknown>): string {
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
        return extractInline(cellParts as Record<string, unknown>[]).replace(/\|/g, "\\|");
      }
      const tc = cellParts as Record<string, unknown>;
      const tcContent = tc.content as Record<string, unknown>[] | undefined;
      if (tcContent) {
        return extractInline(tcContent).replace(/\|/g, "\\|");
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
