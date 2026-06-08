import { describe, it, expect } from "vitest";
import { blocksToText, textToBlocks } from "@/lib/markdown-convert/index";

function b(type: string, text: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    type,
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left", ...extra },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

function bInline(type: string, content: unknown[], extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    type,
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left", ...extra },
    content,
    children: [],
  };
}

describe("textToBlocks", () => {
  it("converts paragraphs", () => {
    const blocks = textToBlocks("hello\nworld") as Record<string, unknown>[];
    expect(blocks.length).toBe(2);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[1].type).toBe("paragraph");
  });

  it("converts headings", () => {
    const blocks = textToBlocks("# H1\n## H2\n### H3") as Record<string, unknown>[];
    expect(blocks.length).toBe(3);
    expect(blocks[0].type).toBe("heading");
    const p0 = blocks[0].props as Record<string, unknown>;
    expect(p0.level).toBe(1);
    const p2 = blocks[2].props as Record<string, unknown>;
    expect(p2.level).toBe(3);
  });

  it("converts bullet lists", () => {
    const blocks = textToBlocks("- item one\n- item two") as Record<string, unknown>[];
    expect(blocks.length).toBe(2);
    expect(blocks[0].type).toBe("bulletListItem");
  });

  it("converts * bullet lists", () => {
    const blocks = textToBlocks("* star item") as Record<string, unknown>[];
    expect(blocks[0].type).toBe("bulletListItem");
  });

  it("converts numbered lists", () => {
    const blocks = textToBlocks("1. first\n2. second") as Record<string, unknown>[];
    expect(blocks.length).toBe(2);
    expect(blocks[0].type).toBe("numberedListItem");
  });

  it("converts toggle directives with child blocks", () => {
    const blocks = textToBlocks("::toggle Reference images\n![Before](garden/x/assets/a.png)\n- check this\n::end-toggle") as Record<string, unknown>[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("toggleListItem");
    const children = blocks[0].children as Record<string, unknown>[];
    expect(children.map((child) => child.type)).toEqual(["image", "bulletListItem"]);
  });

  it("converts checklists", () => {
    const blocks = textToBlocks("- [x] done\n- [ ] pending") as Record<string, unknown>[];
    expect(blocks[0].type).toBe("checkListItem");
    const p0 = blocks[0].props as Record<string, unknown>;
    expect(p0.checked).toBe(true);
    const p1 = blocks[1].props as Record<string, unknown>;
    expect(p1.checked).toBe(false);
  });

  it("converts code blocks", () => {
    const blocks = textToBlocks("```ts\nconst x = 1\n```") as Record<string, unknown>[];
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("codeBlock");
    const p0 = blocks[0].props as Record<string, unknown>;
    expect(p0.language).toBe("ts");
    const c0 = blocks[0].content as Record<string, unknown>[];
    expect((c0[0] as { text: string }).text).toBe("const x = 1");
  });

  it("converts code blocks without language", () => {
    const blocks = textToBlocks("```\nplain code\n```") as Record<string, unknown>[];
    const p0 = blocks[0].props as Record<string, unknown>;
    expect(p0.language).toBe("plaintext");
  });

  it("produces empty paragraph for empty input", () => {
    const blocks = textToBlocks("") as Record<string, unknown>[];
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("paragraph");
  });

  it("produces empty paragraph for whitespace-only input", () => {
    const blocks = textToBlocks("  \n\n  ") as Record<string, unknown>[];
    expect(blocks.length).toBe(1);
  });

  it("skips blank lines", () => {
    const blocks = textToBlocks("a\n\nb") as Record<string, unknown>[];
    expect(blocks.length).toBe(2);
  });

  it("converts horizontal rules", () => {
    const blocks = textToBlocks("---") as Record<string, unknown>[];
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("divider");
  });

  it("converts image markdown to image blocks with API urls", () => {
    const blocks = textToBlocks("![Site photo](garden/bed/assets/photo-1.jpg)") as Record<
      string,
      unknown
    >[];
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("image");
    const props = blocks[0].props as Record<string, unknown>;
    expect(props.caption).toBe("Site photo");
    expect(props.url).toBe("/api/notes-assets/garden/bed/assets/photo-1.jpg");
    expect(props.name).toBe("photo-1.jpg");
  });

  it("converts shared-checklist blocks", () => {
    const blocks = textToBlocks("::shared-checklist abc123 []") as Record<string, unknown>[];
    expect(blocks[0].type).toBe("sharedChecklist");
    expect((blocks[0].props as Record<string, unknown>).masterListId).toBe("abc123");
  });

  it("migrates legacy collection directive to sharedChecklist", () => {
    const blocks = textToBlocks("::collection abc123") as Record<string, unknown>[];
    expect(blocks[0].type).toBe("sharedChecklist");
    expect((blocks[0].props as Record<string, unknown>).masterListId).toBe("abc123");
  });

  it("converts *** horizontal rules", () => {
    const blocks = textToBlocks("***") as Record<string, unknown>[];
    expect(blocks[0].type).toBe("divider");
  });

  it("parses inline bold", () => {
    const blocks = textToBlocks("**bold text**") as Record<string, unknown>[];
    const content = blocks[0].content as Record<string, unknown>[];
    expect(content.length).toBe(1);
    expect(content[0]).toEqual({
      type: "text",
      text: "bold text",
      styles: { bold: true },
    });
  });

  it("parses inline code", () => {
    const blocks = textToBlocks("use `var` here") as Record<string, unknown>[];
    const content = blocks[0].content as Record<string, unknown>[];
    expect(content.length).toBe(3);
    expect(content[0]).toEqual({ type: "text", text: "use ", styles: {} });
    expect(content[1]).toEqual({ type: "text", text: "var", styles: { code: true } });
    expect(content[2]).toEqual({ type: "text", text: " here", styles: {} });
  });

  it("parses inline italic", () => {
    const blocks = textToBlocks("*emphasis*") as Record<string, unknown>[];
    const content = blocks[0].content as Record<string, unknown>[];
    expect(content[0]).toEqual({ type: "text", text: "emphasis", styles: { italic: true } });
  });

  it("parses inline strikethrough", () => {
    const blocks = textToBlocks("~~deleted~~") as Record<string, unknown>[];
    const content = blocks[0].content as Record<string, unknown>[];
    expect(content[0]).toEqual({ type: "text", text: "deleted", styles: { strike: true } });
  });

  it("parses inline links", () => {
    const blocks = textToBlocks("[click here](https://example.com)") as Record<string, unknown>[];
    const content = blocks[0].content as Record<string, unknown>[];
    expect(content[0]).toEqual({
      type: "link",
      href: "https://example.com",
      styles: {},
      content: [{ type: "text", text: "click here", styles: {} }],
    });
  });

  it("parses mixed inline styles in one line", () => {
    const blocks = textToBlocks("**bold** and `code` and *italic*") as Record<string, unknown>[];
    const content = blocks[0].content as Record<string, unknown>[];
    expect(content.length).toBe(5);
    expect(content[0]).toEqual({ type: "text", text: "bold", styles: { bold: true } });
    expect(content[1]).toEqual({ type: "text", text: " and ", styles: {} });
    expect(content[2]).toEqual({ type: "text", text: "code", styles: { code: true } });
    expect(content[3]).toEqual({ type: "text", text: " and ", styles: {} });
    expect(content[4]).toEqual({ type: "text", text: "italic", styles: { italic: true } });
  });

  it("parses inline styles in bullet items", () => {
    const blocks = textToBlocks("- **bold item**") as Record<string, unknown>[];
    const content = blocks[0].content as Record<string, unknown>[];
    expect(content[0]).toEqual({ type: "text", text: "bold item", styles: { bold: true } });
  });

  it("parses inline styles in headings", () => {
    const blocks = textToBlocks("# `code` heading") as Record<string, unknown>[];
    const content = blocks[0].content as Record<string, unknown>[];
    expect(content[0]).toEqual({ type: "text", text: "code", styles: { code: true } });
  });

  it("converts markdown tables", () => {
    const md = "| H1 | H2 |\n| --- | --- |\n| a | b |\n| c | d |";
    const blocks = textToBlocks(md) as Record<string, unknown>[];
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("table");
    const content = blocks[0].content as Record<string, unknown>;
    expect(content.type).toBe("tableContent");
    const rows = content.rows as Record<string, unknown>[];
    expect(rows.length).toBe(3);
    const firstRowCells = rows[0].cells as Record<string, unknown>[][];
    expect(firstRowCells.length).toBe(2);
  });

  it("does not convert single-row pseudo-tables as tables", () => {
    const md = "| not a table |";
    const blocks = textToBlocks(md) as Record<string, unknown>[];
    expect(blocks[0].type).toBe("paragraph");
  });
});

describe("blocksToText", () => {
  it("renders paragraphs", () => {
    expect(blocksToText([b("paragraph", "hello")])).toBe("hello");
  });

  it("renders headings", () => {
    expect(blocksToText([b("heading", "Title", { level: 1 })])).toBe("# Title");
    expect(blocksToText([b("heading", "Sub", { level: 2 })])).toBe("## Sub");
    expect(blocksToText([b("heading", "Deep", { level: 3 })])).toBe("### Deep");
  });

  it("renders bullet lists", () => {
    expect(blocksToText([b("bulletListItem", "item")])).toBe("- item");
  });

  it("renders numbered lists", () => {
    expect(blocksToText([b("numberedListItem", "step")])).toBe("1. step");
  });

  it("renders checklists", () => {
    expect(blocksToText([b("checkListItem", "done", { checked: true })])).toBe("- [x] done");
    expect(blocksToText([b("checkListItem", "todo", { checked: false })])).toBe("- [ ] todo");
  });

  it("renders code blocks", () => {
    const block = {
      id: "x",
      type: "codeBlock",
      props: { language: "ts", textColor: "default", backgroundColor: "default", textAlignment: "left" },
      content: [{ type: "text", text: "const x = 1", styles: {} }],
      children: [],
    };
    expect(blocksToText([block])).toBe("```ts\nconst x = 1\n```");
  });

  it("renders bold inline styles", () => {
    const block = bInline("paragraph", [{ type: "text", text: "bold", styles: { bold: true } }]);
    expect(blocksToText([block])).toBe("**bold**");
  });

  it("renders italic inline styles", () => {
    const block = bInline("paragraph", [{ type: "text", text: "ital", styles: { italic: true } }]);
    expect(blocksToText([block])).toBe("*ital*");
  });

  it("renders code inline styles", () => {
    const block = bInline("paragraph", [{ type: "text", text: "x", styles: { code: true } }]);
    expect(blocksToText([block])).toBe("`x`");
  });

  it("renders strikethrough inline styles", () => {
    const block = bInline("paragraph", [{ type: "text", text: "old", styles: { strike: true } }]);
    expect(blocksToText([block])).toBe("~~old~~");
  });

  it("renders bold+italic inline styles", () => {
    const block = bInline("paragraph", [{ type: "text", text: "both", styles: { bold: true, italic: true } }]);
    expect(blocksToText([block])).toBe("***both***");
  });

  it("renders link inline elements", () => {
    const block = bInline("paragraph", [
      { type: "text", text: "see ", styles: {} },
      { type: "link", href: "https://example.com", content: [{ type: "text", text: "this", styles: {} }] },
    ]);
    expect(blocksToText([block])).toBe("see [this](https://example.com)");
  });

  it("renders dividers", () => {
    const block = { id: "x", type: "divider", props: { textColor: "default" }, children: [] };
    expect(blocksToText([block])).toBe("---");
  });

  it("renders image blocks as markdown with notes-relative paths", () => {
    const block = {
      id: "x",
      type: "image",
      props: {
        caption: "Site",
        url: "/api/notes-assets/garden/bed/assets/photo-1.jpg",
        name: "photo-1.jpg",
      },
      children: [],
    };
    expect(blocksToText([block])).toBe("![Site](garden/bed/assets/photo-1.jpg)");
  });

  it("round-trips image markdown", () => {
    const md = "![Before](garden/x/assets/a.png)";
    expect(blocksToText(textToBlocks(md) as Record<string, unknown>[])).toBe(md);
  });

  it("renders shared-checklist blocks", () => {
    const block = {
      id: "x",
      type: "sharedChecklist",
      props: { masterListId: "abc123", entriesJson: "[]" },
      children: [],
    };
    expect(blocksToText([block])).toBe("::shared-checklist abc123 []");
  });

  it("renders toggle list items as toggle directives", () => {
    const block = {
      id: "x",
      type: "toggleListItem",
      props: {},
      content: [{ type: "text", text: "Before you start", styles: {} }],
      children: [b("bulletListItem", "Wait for a dry day")],
    };
    expect(blocksToText([block])).toBe("::toggle Before you start\n- Wait for a dry day\n::end-toggle");
  });

  it("renders nested children indented", () => {
    const block = {
      id: "x",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "parent", styles: {} }],
      children: [b("paragraph", "child")],
    };
    expect(blocksToText([block])).toBe("parent\n  child");
  });

  it("renders table blocks", () => {
    const tableBlock = {
      id: "x",
      type: "table",
      props: {},
      content: {
        type: "tableContent",
        columnWidths: [undefined, undefined],
        rows: [
          { cells: [[{ type: "text", text: "H1", styles: {} }], [{ type: "text", text: "H2", styles: {} }]] },
          { cells: [[{ type: "text", text: "a", styles: {} }], [{ type: "text", text: "b", styles: {} }]] },
        ],
      },
      children: [],
    };
    const result = blocksToText([tableBlock]);
    expect(result).toBe("| H1 | H2 |\n| --- | --- |\n| a | b |");
  });
});

describe("round-trip: text -> blocks -> text", () => {
  it("round-trips headings", () => {
    const md = "# Title\n## Sub";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips bullets", () => {
    const md = "- one\n- two";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips numbered lists", () => {
    const md = "1. first\n1. second";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips checklists", () => {
    const md = "- [x] done\n- [ ] pending";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips code blocks", () => {
    const md = "```ts\nconst x = 1\n```";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips mixed content", () => {
    const md = "# My Note\n\nA paragraph\n\n- item\n\n```js\nfoo()\n```";
    const result = blocksToText(textToBlocks(md));
    expect(result).toBe("# My Note\nA paragraph\n- item\n```js\nfoo()\n```");
  });

  it("round-trips inline bold", () => {
    const md = "**bold text**";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips inline code", () => {
    const md = "use `var` here";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips inline italic", () => {
    const md = "*emphasis*";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips inline links", () => {
    const md = "[click](https://example.com)";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips mixed inline", () => {
    const md = "**bold** and `code`";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips dividers", () => {
    const md = "before\n---\nafter";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips shared-checklist blocks", () => {
    const md = "before\n::shared-checklist abc123 []\nafter";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips tables", () => {
    const md = "| H1 | H2 |\n| --- | --- |\n| a | b |";
    expect(blocksToText(textToBlocks(md))).toBe(md);
  });

  it("round-trips a task-ref marker with a multi-word label", () => {
    const md = "::task-ref abc-123 2026-05-30 Chase the review";
    const blocks = textToBlocks(md) as Record<string, unknown>[];
    expect(blocks[0].type).toBe("taskRef");
    const props = blocks[0].props as Record<string, unknown>;
    expect(props.taskId).toBe("abc-123");
    expect(props.date).toBe("2026-05-30");
    expect(props.label).toBe("Chase the review");
    expect(blocksToText(blocks)).toBe(md);
  });

  it("round-trips a diagram embed marker", () => {
    const md = "::diagram diagrams/Architecture.json";
    const blocks = textToBlocks(md) as Record<string, unknown>[];
    expect(blocks[0].type).toBe("diagramEmbed");
    expect((blocks[0].props as Record<string, unknown>).path).toBe("diagrams/Architecture.json");
    expect(blocksToText(blocks)).toBe(md);
  });

  it("converts a mermaid fence into a mermaid block and back", () => {
    const md = "```mermaid\ngraph TD\n  A --> B\n```";
    const blocks = textToBlocks(md) as Record<string, unknown>[];
    expect(blocks[0].type).toBe("mermaid");
    expect((blocks[0].props as Record<string, unknown>).code).toBe("graph TD\n  A --> B");
    expect(blocksToText(blocks)).toBe(md);
  });

  it("keeps non-mermaid code fences as code blocks", () => {
    const blocks = textToBlocks("```ts\nconst a = 1;\n```") as Record<string, unknown>[];
    expect(blocks[0].type).toBe("codeBlock");
  });

  it("round-trips a docs-style asset table (sync-engine excerpt)", () => {
    const md = [
      "| Asset           | Source In Repo         | Destination                     |",
      "| --------------- | ---------------------- | ------------------------------- |",
      "| Skills          | `skills/shared/`       | Local tool skill directories    |",
      "| MCP configs     | Shared MCP definitions | Tool-specific MCP config files  |",
    ].join("\n");
    const roundTripped = blocksToText(textToBlocks(md));
    expect(roundTripped).toContain("| Asset");
    expect(roundTripped).toContain("| Skills");
    expect(roundTripped).toContain("`skills/shared/`");
    expect(roundTripped.split("\n").filter((l) => l.startsWith("|")).length).toBeGreaterThanOrEqual(3);
  });
});
