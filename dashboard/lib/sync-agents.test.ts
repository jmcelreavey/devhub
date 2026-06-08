import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAgentSources } from "./sync-agents";
import { pluginRegistryPath } from "./plugins/registry";

let home: string;
let repoRoot: string;
let pluginRoot: string;

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-home-"));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-repo-"));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plugin-"));
});

afterEach(() => {
  for (const d of [home, repoRoot, pluginRoot]) fs.rmSync(d, { recursive: true, force: true });
});

describe("resolveAgentSources", () => {
  it("returns only core agents when no plugins are registered (back-compat)", () => {
    writeFile(path.join(repoRoot, "agents", "shared", "repo-navigator.md"), "core");
    const sources = resolveAgentSources(repoRoot, home);
    expect([...sources.keys()]).toEqual(["repo-navigator"]);
    expect(sources.get("repo-navigator")?.origin).toBe("core");
  });

  it("merges plugin agents and keeps core winning on collisions", () => {
    writeFile(path.join(repoRoot, "agents", "shared", "shared-name.md"), "CORE WINS");
    writeFile(path.join(repoRoot, "agents", "shared", "core-only.md"), "core");

    writeFile(path.join(pluginRoot, "agents", "shared-name.md"), "PLUGIN LOSES");
    writeFile(path.join(pluginRoot, "agents", "plugin-only.md"), "plugin");
    writeFile(
      path.join(pluginRoot, "devhub-plugin.json"),
      JSON.stringify({ name: "bi", version: "0.1.0", devhubApi: "1", contributes: { agents: "agents/" } }),
    );
    const reg = pluginRegistryPath(home);
    fs.mkdirSync(path.dirname(reg), { recursive: true });
    fs.writeFileSync(reg, JSON.stringify({ plugins: [{ name: "bi", path: pluginRoot, enabled: true }] }));

    const sources = resolveAgentSources(repoRoot, home);
    expect([...sources.keys()].sort()).toEqual(["core-only", "plugin-only", "shared-name"]);

    // collision: core file kept
    expect(fs.readFileSync(sources.get("shared-name")!.file, "utf-8")).toBe("CORE WINS");
    expect(sources.get("shared-name")?.origin).toBe("core");
    // plugin-only tagged with plugin origin
    expect(sources.get("plugin-only")?.origin).toBe("plugin:bi");
  });
});
