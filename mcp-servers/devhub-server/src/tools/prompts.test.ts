import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSkillPromptText, listSkillPromptSources, parseSkillFrontmatter } from "./prompts.ts";

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "skill-prompts-"));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function writeSkill(relDir: string, content: string): void {
  const dir = path.join(repo, "skills", relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), content);
}

describe("parseSkillFrontmatter", () => {
  it("reads quoted inline values", () => {
    expect(parseSkillFrontmatter('---\nname: my-skill\ndescription: "Does \\"things\\""\n---\nbody')).toEqual({
      name: "my-skill",
      description: 'Does "things"',
    });
  });

  it("folds >- block scalars and keeps | literal lines", () => {
    expect(parseSkillFrontmatter("---\ndescription: >-\n  Line one\n  line two\nname: x\n---\n").description).toBe(
      "Line one line two",
    );
    expect(parseSkillFrontmatter("---\ndescription: |\n  a\n  b\n---\n").description).toBe("a\nb");
  });

  it("ignores content without frontmatter", () => {
    expect(parseSkillFrontmatter("# Skill\ndescription: not frontmatter")).toEqual({});
  });
});

describe("listSkillPromptSources", () => {
  it("prefers shared over vendor over root installs and skips non-skills", () => {
    writeSkill("shared/review", "---\ndescription: shared review\n---\n");
    writeSkill("vendor/review", "---\ndescription: vendor review\n---\n");
    writeSkill("vendor/archaeology", "---\ndescription: dig\n---\n");
    writeSkill("hallmark", "no frontmatter");
    fs.mkdirSync(path.join(repo, "skills", "shared", "empty-dir"), { recursive: true });

    const sources = listSkillPromptSources(repo);
    expect(sources.map((s) => [s.name, s.description])).toEqual([
      ["archaeology", "dig"],
      ["hallmark", "DevHub skill hallmark"],
      ["review", "shared review"],
    ]);
    expect(listSkillPromptSources(path.join(repo, "missing"))).toEqual([]);
  });
});

describe("buildSkillPromptText", () => {
  it("includes the skill body, its directory and the task", () => {
    const text = buildSkillPromptText({ name: "review", description: "", dir: "/skills/review", file: "" }, "Do the review.\n", "PR #12");
    expect(text).toContain('Use the "review" DevHub skill');
    expect(text).toContain("relative to /skills/review");
    expect(text).toContain("Do the review.");
    expect(text.endsWith("Task: PR #12")).toBe(true);
  });
});
