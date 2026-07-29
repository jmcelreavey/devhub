import { describe, expect, it } from "vitest";
import {
  inlineToPlainText,
  parseMarkdown,
  slugify,
  type DocNode,
} from "@/lib/docs/markdown-ast";

function nodesOf(markdown: string): DocNode[] {
  return parseMarkdown(markdown).nodes;
}

describe("headings and toc", () => {
  it("assigns stable anchor ids and collects h2/h3 into the toc", () => {
    const { nodes, toc, firstHeading } = parseMarkdown(
      "# Page Title\n\n## Setting Up\n\n### Env Vars\n\n#### Too deep\n",
    );
    expect(firstHeading).toBe("Page Title");
    expect(nodes.filter((n) => n.type === "heading")).toHaveLength(4);
    expect(toc).toEqual([
      { id: "setting-up", text: "Setting Up", level: 2 },
      { id: "env-vars", text: "Env Vars", level: 3 },
    ]);
  });

  it("de-duplicates repeated heading slugs", () => {
    const { toc } = parseMarkdown("## Setup\n\n## Setup\n");
    expect(toc.map((t) => t.id)).toEqual(["setup", "setup-1"]);
  });

  it("strips inline formatting out of anchor text", () => {
    expect(slugify("`npm run dev` and the *fast* path")).toBe("npm-run-dev-and-the-fast-path");
  });

  it("keeps consecutive hyphens so anchors match GitHub", () => {
    expect(slugify("Tier 3 — branding (whitelabel)")).toBe("tier-3--branding-whitelabel");
  });
});

describe("inline parsing", () => {
  it("handles bold, italic, strike and code", () => {
    const [node] = nodesOf("**bold** *ital* ~~gone~~ `code`");
    if (node.type !== "paragraph") throw new Error("expected paragraph");
    const styled = node.content.filter((n) => n.type === "text");
    expect(styled.find((n) => n.type === "text" && n.value === "bold")).toMatchObject({
      styles: { bold: true },
    });
    expect(styled.find((n) => n.type === "text" && n.value === "ital")).toMatchObject({
      styles: { italic: true },
    });
    expect(styled.find((n) => n.type === "text" && n.value === "gone")).toMatchObject({
      styles: { strike: true },
    });
    expect(styled.find((n) => n.type === "text" && n.value === "code")).toMatchObject({
      styles: { code: true },
    });
  });

  it("does not parse markdown inside inline code", () => {
    const [node] = nodesOf("`a **b** c`");
    if (node.type !== "paragraph") throw new Error("expected paragraph");
    expect(inlineToPlainText(node.content)).toBe("a **b** c");
  });

  it("preserves angle-bracket placeholders inside inline code", () => {
    const [node] = nodesOf("Use `<domain>_<verb>` for the key.");
    if (node.type !== "paragraph") throw new Error("expected paragraph");
    expect(inlineToPlainText(node.content)).toBe("Use <domain>_<verb> for the key.");
  });

  it("parses links and records them", () => {
    const { links } = parseMarkdown("See [the guide](guides/theming.md) for detail.");
    expect(links).toEqual([{ href: "guides/theming.md", text: "the guide" }]);
  });

  it("strips a markdown link title from the href", () => {
    const { links } = parseMarkdown('[x](/docs/a "Title")');
    expect(links[0].href).toBe("/docs/a");
  });

  it("honours backslash escapes", () => {
    const [node] = nodesOf("not \\*emphasis\\* here");
    if (node.type !== "paragraph") throw new Error("expected paragraph");
    expect(inlineToPlainText(node.content)).toBe("not *emphasis* here");
  });
});

describe("code fences", () => {
  it("keeps code verbatim and tags the language", () => {
    const [node] = nodesOf("```ts\nconst a = 1;\n// **not bold**\n```");
    expect(node).toEqual({ type: "code", lang: "ts", value: "const a = 1;\n// **not bold**" });
  });

  it("routes mermaid fences to their own node", () => {
    const [node] = nodesOf("```mermaid\ngraph TD\n  A --> B\n```");
    expect(node).toEqual({ type: "mermaid", code: "graph TD\n  A --> B" });
  });
});

describe("callouts and blockquotes", () => {
  it("recognises GitHub callout syntax", () => {
    const [node] = nodesOf("> [!WARNING] Mind the gap\n> Body text.");
    if (node.type !== "callout") throw new Error("expected callout");
    expect(node.variant).toBe("warning");
    expect(node.title).toBe("Mind the gap");
    expect(node.children[0].type).toBe("paragraph");
  });

  it("falls back to a plain blockquote", () => {
    const [node] = nodesOf("> just a quote");
    expect(node.type).toBe("blockquote");
  });
});

describe("lists", () => {
  it("parses nested bullets", () => {
    const [node] = nodesOf("- one\n  - nested\n- two");
    if (node.type !== "list") throw new Error("expected list");
    expect(node.ordered).toBe(false);
    expect(node.items).toHaveLength(2);
    expect(node.items[0].children[0].type).toBe("list");
  });

  it("parses task list checkboxes", () => {
    const [node] = nodesOf("- [x] done\n- [ ] todo");
    if (node.type !== "list") throw new Error("expected list");
    expect(node.items.map((i) => i.checked)).toEqual([true, false]);
  });

  it("keeps ordered list start numbers", () => {
    const [node] = nodesOf("3. three\n4. four");
    if (node.type !== "list") throw new Error("expected list");
    expect(node.ordered).toBe(true);
    expect(node.start).toBe(3);
  });
});

describe("tables", () => {
  it("parses header, alignment and rows", () => {
    const [node] = nodesOf("| A | B |\n| :- | --: |\n| 1 | 2 |\n");
    if (node.type !== "table") throw new Error("expected table");
    expect(node.align).toEqual(["left", "right"]);
    expect(node.header.map(inlineToPlainText)).toEqual(["A", "B"]);
    expect(node.rows[0].map(inlineToPlainText)).toEqual(["1", "2"]);
  });
});

describe("misc blocks", () => {
  it("treats --- as a divider, not a list", () => {
    const [node] = nodesOf("---\n");
    expect(node.type).toBe("divider");
  });

  it("promotes a standalone image to a figure node", () => {
    const [node] = nodesOf("![A diagram](assets/flow.png)");
    expect(node).toEqual({ type: "image", alt: "A diagram", src: "assets/flow.png" });
  });

  it("escapes raw HTML instead of passing it through", () => {
    const [node] = nodesOf("<script>alert(1)</script> hello");
    if (node.type !== "paragraph") throw new Error("expected paragraph");
    expect(inlineToPlainText(node.content)).toBe("alert(1) hello");
  });

  it("breaks a paragraph when a new block starts without a blank line", () => {
    const nodes = nodesOf("text\n## Heading");
    expect(nodes.map((n) => n.type)).toEqual(["paragraph", "heading"]);
  });
});
