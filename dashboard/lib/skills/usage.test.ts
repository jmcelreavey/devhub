import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { countSkillInvocations, skillUsageFor } from "@/lib/skills/usage";

describe("skill usage", () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  function transcript(project: string, name: string, lines: string[], mtimeMs?: number) {
    const projectDir = path.join(dir, project);
    fs.mkdirSync(projectDir, { recursive: true });
    const file = path.join(projectDir, name);
    fs.writeFileSync(file, lines.join("\n"));
    if (mtimeMs !== undefined) fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  }

  it("counts skill tool calls across projects and skips stale transcripts", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-skill-usage-"));
    transcript("a", "s1.jsonl", ['{"input":{"skill":"create-pr"}}', '{"input":{"skill": "create-pr"}}']);
    transcript("b", "s2.jsonl", ['{"input":{"skill":"figma:figma-use"}}']);
    transcript("b", "old.jsonl", ['{"input":{"skill":"create-pr"}}'], Date.now() - 90 * 86_400_000);
    transcript("b", "notes.txt", ['"skill":"create-pr"']);
    transcript("b/s2/subagents", "agent-1.jsonl", ['{"input":{"skill":"create-pr"}}']);

    const counts = await countSkillInvocations(Date.now() - 30 * 86_400_000, dir);

    expect(counts.get("create-pr")).toBe(3);
    expect(counts.get("figma:figma-use")).toBe(1);
  });

  it("lists unused skills first", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-skill-usage-"));
    transcript("a", "s1.jsonl", ['{"input":{"skill":"create-pr"}}']);

    expect(await skillUsageFor(["create-pr", "rubber-duck"], 0, dir)).toEqual([
      { skill: "rubber-duck", invocations: 0 },
      { skill: "create-pr", invocations: 1 },
    ]);
  });

  it("returns nothing when the projects dir is missing", async () => {
    expect((await countSkillInvocations(0, path.join(os.tmpdir(), "does-not-exist-devhub"))).size).toBe(0);
  });
});
