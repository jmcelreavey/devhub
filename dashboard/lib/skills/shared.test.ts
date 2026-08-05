import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { descriptionFromFrontmatter, listSkillDirNames, resolveSkillDirUnder } from "@/lib/skills/shared";

describe("skills-shared", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("lists skill directories with SKILL.md", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-skills-shared-"));
    fs.mkdirSync(path.join(tmp, "alpha"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "alpha/SKILL.md"), "---\ndescription: Alpha skill\n---\n");
    fs.mkdirSync(path.join(tmp, "empty-dir"), { recursive: true });

    expect(listSkillDirNames(tmp)).toEqual(["alpha"]);
    expect(resolveSkillDirUnder(tmp, "alpha")).toBe(path.join(tmp, "alpha"));
    expect(resolveSkillDirUnder(tmp, "empty-dir")).toBeNull();
  });

  it("parses description from frontmatter", () => {
    expect(descriptionFromFrontmatter("---\ndescription: Do the thing\n---\n")).toBe("Do the thing");
  });
});

const frontmatter = (body: string) => `---\n${body}\n---\n\n# Heading\n\nBody prose.\n`;

describe("descriptionFromFrontmatter", () => {
  it("strips surrounding quotes but keeps apostrophes", () => {
    // The previous implementation stripped every quote character, so an
    // apostrophe inside the text was collateral: "Don't" became "Dont".
    expect(descriptionFromFrontmatter(frontmatter(`description: "Don't break this"`))).toBe(
      "Don't break this",
    );
    expect(descriptionFromFrontmatter(frontmatter("description: 'Single quoted'"))).toBe(
      "Single quoted",
    );
  });

  describe("YAML block scalars", () => {
    it("folds a `>-` description into one line", () => {
      // The exact shape that reported ">-" for 10 of 42 skills.
      const content = frontmatter(
        [
          "name: create-pr",
          "description: >-",
          "  Create a GitHub pull request with repo-aligned title/body,",
          "  with draft vs execution modes. Use when the user asks to",
          "  create or open a PR.",
        ].join("\n"),
      );
      expect(descriptionFromFrontmatter(content)).toBe(
        "Create a GitHub pull request with repo-aligned title/body, with draft vs execution modes. Use when the user asks to create or open a PR.",
      );
    });

    it("never returns a bare indicator", () => {
      for (const indicator of [">-", ">", "|", "|-", ">+", "|+"]) {
        const content = frontmatter(`description: ${indicator}\n  Real text here.`);
        expect(descriptionFromFrontmatter(content)).toBe("Real text here.");
      }
    });

    it("keeps line breaks for a literal `|` block", () => {
      const content = frontmatter("description: |\n  Line one.\n  Line two.");
      expect(descriptionFromFrontmatter(content)).toBe("Line one.\nLine two.");
    });

    it("treats a blank line as a paragraph break when folding", () => {
      const content = frontmatter(
        "description: >-\n  First para line one\n  line two.\n\n  Second para.",
      );
      expect(descriptionFromFrontmatter(content)).toBe(
        "First para line one line two.\n\nSecond para.",
      );
    });

    it("stops at the next frontmatter key", () => {
      const content = frontmatter(
        ["description: >-", "  Only this text.", "allowed-tools: Read, Write", "model: sonnet"].join(
          "\n",
        ),
      );
      expect(descriptionFromFrontmatter(content)).toBe("Only this text.");
    });

    it("stops at the closing delimiter", () => {
      const content = "---\ndescription: >-\n  Just this.\n---\n\nBody text that must not leak in.\n";
      expect(descriptionFromFrontmatter(content)).toBe("Just this.");
    });

    it("returns null for an empty block", () => {
      expect(descriptionFromFrontmatter("---\ndescription: >-\n---\n")).toBeNull();
    });

    it("handles deeper indentation", () => {
      const content = frontmatter("description: >-\n      Indented four extra spaces.");
      expect(descriptionFromFrontmatter(content)).toBe("Indented four extra spaces.");
    });
  });

  it("falls back to the first prose line with no frontmatter", () => {
    expect(descriptionFromFrontmatter("# Title\n\nA plain description line.\n")).toBe(
      "A plain description line.",
    );
  });

  it("returns null when there is nothing usable", () => {
    expect(descriptionFromFrontmatter("")).toBeNull();
    expect(descriptionFromFrontmatter("# Only a heading\n")).toBeNull();
  });
});
