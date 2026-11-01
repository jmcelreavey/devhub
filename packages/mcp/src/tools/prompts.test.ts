import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRaceVerdictPrompt,
  buildSkillPromptText,
  listSkillPromptSources,
  parseRaceRunIds,
  parseSkillFrontmatter,
  registerRaceVerdictPrompt,
} from "./prompts.ts";

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

describe("parseRaceRunIds", () => {
  it("splits, trims and validates run ids", () => {
    expect(parseRaceRunIds(" run-a , run-b ")).toEqual({ runIds: ["run-a", "run-b"] });
  });

  it("needs at least two ids", () => {
    expect(parseRaceRunIds("run-a").error).toMatch(/at least two/);
    expect(parseRaceRunIds("").error).toMatch(/at least two/);
  });

  it("rejects non run ids", () => {
    expect(parseRaceRunIds("run-a, rm -rf /").error).toMatch(/Not valid run ids/);
  });
});

describe("buildRaceVerdictPrompt", () => {
  it("includes every run id and the write path", () => {
    const text = buildRaceVerdictPrompt(["run-a", "run-b"], "task-2026-09-14");
    expect(text).toContain('agent_diff("run-a")');
    expect(text).toContain('agent_diff("run-b")');
    expect(text).toContain("notes_write");
    expect(text).toContain("task-2026-09-14");
  });

  it("without a taskRef still instructs on linking", () => {
    const text = buildRaceVerdictPrompt(["run-a", "run-b"]);
    expect(text).toContain("entity links");
    expect(text).not.toContain("undefined");
  });
});

describe("registerRaceVerdictPrompt", () => {
  it("registers the prompt and returns the error text for bad ids", () => {
    const prompts: Array<{ name: string; callback: (args: { runIds: string }) => { messages: Array<{ content: { text: string } }> } }> = [];
    const server = {
      registerPrompt(name: string, _config: unknown, callback: (args: { runIds: string }) => { messages: Array<{ content: { text: string } }> }) {
        prompts.push({ name, callback });
      },
    } as never;
    registerRaceVerdictPrompt(server);
    expect(prompts.map((p) => p.name)).toEqual(["agent_race_verdict"]);
    const bad = prompts[0].callback({ runIds: "nope" });
    expect(bad.messages[0].content.text).toContain("Cannot build the race verdict");
    const good = prompts[0].callback({ runIds: "run-a,run-b" });
    expect(good.messages[0].content.text).toContain('agent_diff("run-a")');
  });
});
