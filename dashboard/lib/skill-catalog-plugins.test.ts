import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildMergedSkillCatalog,
  catalogOriginCounts,
  listSkillsFromCatalog,
  upstreamOnlySkillNames,
} from "./skill-catalog";
import { pluginRegistryPath } from "./plugins/registry";

let home: string;
let repoRoot: string;
let pluginRoot: string;

function writeSkill(parent: string, name: string, body: string): void {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${body}\n---\n`);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-home-"));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-repo-"));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plugin-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  // Ensure ai-tools upstream is off so the test is isolated to core + plugin.
  process.env.AI_TOOLS_SYNC = "0";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AI_TOOLS_SYNC;
  for (const d of [home, repoRoot, pluginRoot]) fs.rmSync(d, { recursive: true, force: true });
});

function registerBiPlugin(): void {
  fs.writeFileSync(
    path.join(pluginRoot, "devhub-plugin.json"),
    JSON.stringify({ name: "bi", version: "0.1.0", devhubApi: "1", contributes: { skills: "skills/" } }),
  );
  const reg = pluginRegistryPath(home);
  fs.mkdirSync(path.dirname(reg), { recursive: true });
  fs.writeFileSync(reg, JSON.stringify({ plugins: [{ name: "bi", path: pluginRoot, enabled: true }] }));
}

describe("buildMergedSkillCatalog with plugins", () => {
  it("returns only core skills when no plugins are registered (back-compat)", () => {
    writeSkill(path.join(repoRoot, "skills", "shared"), "create-pr", "core");
    const catalog = buildMergedSkillCatalog(repoRoot);
    expect(catalog.map((e) => e.name)).toEqual(["create-pr"]);
    expect(catalog[0].origin).toBe("devhub");
    expect(catalogOriginCounts(catalog)).toEqual({ devhub: 1, aiTools: 0, plugins: 0 });
  });

  it("merges plugin skills, marks them read-only, and lets core win on collisions", () => {
    writeSkill(path.join(repoRoot, "skills", "shared"), "shared-skill", "CORE");
    writeSkill(path.join(repoRoot, "skills", "shared"), "core-only", "core");
    writeSkill(path.join(pluginRoot, "skills"), "shared-skill", "PLUGIN");
    writeSkill(path.join(pluginRoot, "skills"), "bi-iam", "plugin");
    registerBiPlugin();

    const catalog = buildMergedSkillCatalog(repoRoot);
    const byName = Object.fromEntries(catalog.map((e) => [e.name, e]));

    expect(byName["bi-iam"].origin).toBe("plugin:bi");
    // collision: core kept, plugin copy dropped
    expect(byName["shared-skill"].origin).toBe("devhub");
    expect(byName["shared-skill"].dir).toContain(path.join("skills", "shared"));
    expect(catalogOriginCounts(catalog)).toEqual({ devhub: 2, aiTools: 0, plugins: 1 });

    const list = listSkillsFromCatalog(catalog);
    expect(list.find((s) => s.name === "bi-iam")?.readOnly).toBe(true);
    expect(list.find((s) => s.name === "core-only")?.readOnly).toBe(false);
  });

  it("treats plugin-only skills as non-collectible (upstreamOnlySkillNames)", () => {
    writeSkill(path.join(pluginRoot, "skills"), "bi-iam", "plugin");
    registerBiPlugin();
    expect(upstreamOnlySkillNames(repoRoot).has("bi-iam")).toBe(true);
  });
});
