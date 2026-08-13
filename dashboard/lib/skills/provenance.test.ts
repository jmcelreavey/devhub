import { describe, expect, it } from "vitest";
import {
  formatProvenanceProblems,
  provenanceFromFrontmatter,
  validateVendorProvenance,
} from "./provenance";

const VENDORED = `---
name: scope-creep-detector
description: >-
  Analyzes git diffs against a stated intent.
license: Apache-2.0
metadata:
  author: "Matt Van Horn"
  version: "1.0.0"
  source: "https://github.com/Shubhamsaboo/awesome-llm-apps"
---

# Scope Creep Detector
`;

describe("provenanceFromFrontmatter", () => {
  it("reads top-level licence and nested metadata", () => {
    expect(provenanceFromFrontmatter(VENDORED)).toEqual({
      license: "Apache-2.0",
      author: "Matt Van Horn",
      version: "1.0.0",
      source: "https://github.com/Shubhamsaboo/awesome-llm-apps",
    });
  });

  it("returns empty provenance when there is no frontmatter", () => {
    expect(provenanceFromFrontmatter("# Just a heading\n")).toEqual({
      license: null,
      author: null,
      version: null,
      source: null,
    });
  });

  it("ignores an unterminated frontmatter block", () => {
    const unterminated = "---\nlicense: MIT\nname: broken\n";
    expect(provenanceFromFrontmatter(unterminated).license).toBeNull();
  });

  it("does not read metadata keys once the block returns to top level", () => {
    // `author` here belongs to a sibling top-level key, not to metadata. Treating
    // indentation as meaningful is the whole reason this isn't a flat regex.
    const content = `---
license: MIT
metadata:
  version: "2.0.0"
other:
  author: "Not the skill author"
---
`;
    const result = provenanceFromFrontmatter(content);
    expect(result.version).toBe("2.0.0");
    expect(result.author).toBeNull();
  });

  it("strips surrounding quotes but leaves inner apostrophes", () => {
    const content = `---
license: "Apache-2.0"
metadata:
  author: "O'Brien"
---
`;
    const result = provenanceFromFrontmatter(content);
    expect(result.license).toBe("Apache-2.0");
    expect(result.author).toBe("O'Brien");
  });

  it("does not mistake a description mentioning license for the field", () => {
    const content = `---
description: "Checks whether a license header is present"
license: MIT
---
`;
    expect(provenanceFromFrontmatter(content).license).toBe("MIT");
  });
});

describe("validateVendorProvenance", () => {
  it("reports nothing for a directory that does not exist", () => {
    // Missing dir reads as empty provenance, so every field is missing — the
    // caller only passes real catalog entries, but this must not throw.
    const problems = validateVendorProvenance([{ name: "ghost", dir: "/nope/ghost" }]);
    expect(problems).toEqual([
      { skill: "ghost", missing: ["license", "author", "version", "source"] },
    ]);
  });

  it("formats problems with a remediation hint", () => {
    const message = formatProvenanceProblems([{ skill: "x", missing: ["license"] }]);
    expect(message).toContain("1 vendored skill missing provenance:");
    expect(message).toContain("x: no license");
    expect(message).toContain("NOTICE.md");
  });
});
