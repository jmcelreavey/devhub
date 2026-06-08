import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { descriptionFromFrontmatter, listSkillDirNames, resolveSkillDirUnder } from "./skills-shared";

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
