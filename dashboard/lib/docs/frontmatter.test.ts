import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  withFrontmatter,
} from "@/lib/docs/frontmatter";

describe("parseFrontmatter", () => {
  it("returns the source untouched when there is no block", () => {
    const result = parseFrontmatter("# Title\n\nBody.");
    expect(result.hasFrontmatter).toBe(false);
    expect(result.body).toBe("# Title\n\nBody.");
    expect(result.frontmatter).toEqual({});
  });

  it("parses scalars, inline arrays and block arrays", () => {
    const source = [
      "---",
      "title: Architecture Overview",
      'description: "How it: fits together"',
      "section: architecture",
      "order: 1",
      "draft: false",
      "tags: [core, architecture]",
      "related:",
      "  - guides/theming.md",
      "  - reference/api-routes.md",
      "---",
      "",
      "# Architecture Overview",
    ].join("\n");

    const { frontmatter, body, hasFrontmatter } = parseFrontmatter(source);
    expect(hasFrontmatter).toBe(true);
    expect(frontmatter).toEqual({
      title: "Architecture Overview",
      description: "How it: fits together",
      section: "architecture",
      order: 1,
      tags: ["core", "architecture"],
      related: ["guides/theming.md", "reference/api-routes.md"],
    });
    expect(body).toBe("# Architecture Overview");
  });

  it("treats an unterminated block as body rather than swallowing content", () => {
    const source = "---\ntitle: Broken\n\n# Heading";
    const result = parseFrontmatter(source);
    expect(result.hasFrontmatter).toBe(false);
    expect(result.body).toContain("# Heading");
  });

  it("drops draft: false rather than storing it", () => {
    const { frontmatter } = parseFrontmatter("---\ndraft: false\n---\n\nx");
    expect(frontmatter.draft).toBeUndefined();
  });

  it("ignores unknown keys", () => {
    const { frontmatter } = parseFrontmatter("---\ntitle: A\nnonsense: b\n---\n\nx");
    expect(frontmatter).toEqual({ title: "A" });
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips through the parser", () => {
    const fm = {
      title: "Theming",
      description: "Tokens and themes",
      section: "guides",
      order: 3,
      tags: ["ui", "theming"],
      related: ["architecture/dashboard"],
    };
    const source = `${serializeFrontmatter(fm)}\n# Theming\n`;
    expect(parseFrontmatter(source).frontmatter).toEqual(fm);
  });

  it("returns an empty string for empty metadata", () => {
    expect(serializeFrontmatter({})).toBe("");
  });

  it("quotes values that would confuse the parser", () => {
    const out = serializeFrontmatter({ title: "Jira: setup" });
    expect(out).toContain('title: "Jira: setup"');
    expect(parseFrontmatter(`${out}\nbody`).frontmatter.title).toBe("Jira: setup");
  });
});

describe("withFrontmatter", () => {
  it("replaces an existing block without duplicating it", () => {
    const source = "---\ntitle: Old\n---\n\n# Body\n";
    const next = withFrontmatter(source, { title: "New" });
    expect(next).toContain("title: New");
    expect(next).not.toContain("title: Old");
    expect(next.match(/^---$/gm)?.length).toBe(2);
    expect(next).toContain("# Body");
  });

  it("inserts a block when there was none", () => {
    const next = withFrontmatter("# Body\n", { title: "New" });
    expect(next.startsWith("---\ntitle: New\n---")).toBe(true);
  });
});
