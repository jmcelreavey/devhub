import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildMergedSkillCatalog, listSkillsForApi } from "./skill-catalog";

describe("skill-catalog", () => {
  const prevAiToolsRoot = process.env.AI_TOOLS_ROOT;
  const prevAiToolsSync = process.env.AI_TOOLS_SYNC;
  let repo: string;
  let aiTools: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-catalog-repo-"));
    aiTools = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-catalog-aitools-"));
    process.env.AI_TOOLS_ROOT = aiTools;
    delete process.env.AI_TOOLS_SYNC;

    fs.mkdirSync(path.join(repo, "skills/shared/devhub-only"), { recursive: true });
    fs.writeFileSync(path.join(repo, "skills/shared/devhub-only/SKILL.md"), "---\ndescription: devhub\n---\n");

    fs.mkdirSync(path.join(repo, "skills/shared/shared-name"), { recursive: true });
    fs.writeFileSync(path.join(repo, "skills/shared/shared-name/SKILL.md"), "---\ndescription: from devhub\n---\n");

    fs.mkdirSync(path.join(repo, "skills/shared/bi-overridden"), { recursive: true });
    fs.writeFileSync(path.join(repo, "skills/shared/bi-overridden/SKILL.md"), "---\ndescription: override\n---\n");

    fs.mkdirSync(path.join(aiTools, "skills"), { recursive: true });
    fs.mkdirSync(path.join(aiTools, "skills/upstream-only"), { recursive: true });
    fs.writeFileSync(path.join(aiTools, "skills/upstream-only/SKILL.md"), "---\ndescription: upstream\n---\n");

    fs.mkdirSync(path.join(aiTools, "skills/shared-name"), { recursive: true });
    fs.writeFileSync(path.join(aiTools, "skills/shared-name/SKILL.md"), "---\ndescription: from ai-tools\n---\n");

    fs.mkdirSync(path.join(aiTools, "skills/overridden"), { recursive: true });
    fs.writeFileSync(path.join(aiTools, "skills/overridden/SKILL.md"), "---\ndescription: overridden\n---\n");
  });

  afterEach(() => {
    if (prevAiToolsRoot === undefined) delete process.env.AI_TOOLS_ROOT;
    else process.env.AI_TOOLS_ROOT = prevAiToolsRoot;
    if (prevAiToolsSync === undefined) delete process.env.AI_TOOLS_SYNC;
    else process.env.AI_TOOLS_SYNC = prevAiToolsSync;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(aiTools, { recursive: true, force: true });
  });

  it("merges devhub and ai-tools with BI-prefixed upstream names", () => {
    const catalog = buildMergedSkillCatalog(repo);
    const byName = Object.fromEntries(catalog.map((e) => [e.name, e]));

    expect(byName["devhub-only"]?.origin).toBe("devhub");
    expect(byName["bi-upstream-only"]?.origin).toBe("ai-tools");
    expect(byName["bi-upstream-only"]?.sourceName).toBe("upstream-only");
    expect(byName["shared-name"]?.origin).toBe("devhub");
    expect(byName["bi-shared-name"]?.origin).toBe("ai-tools");
    expect(byName["shared-name"]?.overridesUpstream).toBe(false);
    expect(byName["shared-name"]?.dir).toContain(path.join("skills", "shared", "shared-name"));
    expect(byName["bi-overridden"]?.origin).toBe("devhub");
    expect(byName["bi-overridden"]?.overridesUpstream).toBe(true);
  });

  it("lists api items with readOnly for ai-tools-only", () => {
    const items = listSkillsForApi(repo);
    const upstream = items.find((i) => i.name === "bi-upstream-only");
    const shared = items.find((i) => i.name === "shared-name");
    const override = items.find((i) => i.name === "bi-overridden");
    expect(upstream?.readOnly).toBe(true);
    expect(upstream?.source).toBe("ai-tools");
    expect(shared?.readOnly).toBe(false);
    expect(shared?.overridesUpstream).toBe(false);
    expect(override?.overridesUpstream).toBe(true);
  });

  it("ignores ai-tools when AI_TOOLS_SYNC=0", () => {
    process.env.AI_TOOLS_SYNC = "0";
    const catalog = buildMergedSkillCatalog(repo);
    expect(catalog.some((e) => e.name === "bi-upstream-only")).toBe(false);
  });
});
