import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pluginMcpServerDirs } from "./plugin-mcp-deps";
import { pluginRegistryPath } from "./plugins/registry";

let home: string;
let pluginRoot: string;

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-home-"));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plugin-"));
  writeJson(path.join(pluginRoot, "devhub-plugin.json"), {
    name: "bi",
    version: "0.1.0",
    devhubApi: "1",
    contributes: { mcp: "mcp/" },
  });
  writeJson(pluginRegistryPath(home), { plugins: [{ name: "bi", path: pluginRoot, enabled: true }] });
});

afterEach(() => {
  for (const d of [home, pluginRoot]) fs.rmSync(d, { recursive: true, force: true });
});

describe("pluginMcpServerDirs", () => {
  it("finds server packages and reports node_modules presence", () => {
    writeJson(path.join(pluginRoot, "mcp-servers", "devhub-bi-server", "package.json"), { name: "x" });
    fs.mkdirSync(path.join(pluginRoot, "mcp-servers", "devhub-bi-server", "node_modules"), { recursive: true });
    // A non-package dir is ignored.
    fs.mkdirSync(path.join(pluginRoot, "mcp-servers", "not-a-pkg"), { recursive: true });

    const dirs = pluginMcpServerDirs(home);
    expect(dirs).toHaveLength(1);
    expect(dirs[0].plugin).toBe("bi");
    expect(path.basename(dirs[0].dir)).toBe("devhub-bi-server");
    expect(dirs[0].hasNodeModules).toBe(true);
  });

  it("returns empty when the plugin ships no mcp-servers dir", () => {
    expect(pluginMcpServerDirs(home)).toEqual([]);
  });
});
