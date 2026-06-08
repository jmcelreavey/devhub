import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pluginMcpServers, readCatalogMcpServer } from "./sync-mcp";
import { pluginRegistryPath } from "./plugins/registry";

let home: string;
let repoRoot: string;
let pluginRoot: string;

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function registerPlugin(): void {
  writeJson(path.join(pluginRoot, "devhub-plugin.json"), {
    name: "bi",
    version: "0.1.0",
    devhubApi: "1",
    contributes: { mcp: "mcp/" },
  });
  writeJson(pluginRegistryPath(home), { plugins: [{ name: "bi", path: pluginRoot, enabled: true }] });
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-home-"));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-repo-"));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plugin-"));
});

afterEach(() => {
  for (const d of [home, repoRoot, pluginRoot]) fs.rmSync(d, { recursive: true, force: true });
});

describe("pluginMcpServers", () => {
  it("lists valid server JSONs from plugin mcp dirs", () => {
    writeJson(path.join(pluginRoot, "mcp", "bi-tools.json"), { command: "node", args: ["x"] });
    writeJson(path.join(pluginRoot, "mcp", "BAD NAME.json"), { command: "node" });
    registerPlugin();
    const map = pluginMcpServers(home);
    expect([...map.keys()]).toEqual(["bi-tools"]);
    expect(map.get("bi-tools")?.origin).toBe("plugin:bi");
  });

  it("returns an empty map with no registry (back-compat)", () => {
    expect(pluginMcpServers(home).size).toBe(0);
  });
});

describe("readCatalogMcpServer precedence", () => {
  it("resolves a plugin server when not in core repo", () => {
    writeJson(path.join(pluginRoot, "mcp", "bi-tools.json"), { command: "bi" });
    registerPlugin();
    const resolved = readCatalogMcpServer(repoRoot, home, "bi-tools");
    expect(resolved?.source).toBe("plugin");
    expect(resolved?.server.command).toBe("bi");
  });

  it("lets core repo win over a same-named plugin server", () => {
    writeJson(path.join(repoRoot, "mcp", "shared", "dup.json"), { command: "CORE" });
    writeJson(path.join(pluginRoot, "mcp", "dup.json"), { command: "PLUGIN" });
    registerPlugin();
    const resolved = readCatalogMcpServer(repoRoot, home, "dup");
    expect(resolved?.source).toBe("repo");
    expect(resolved?.server.command).toBe("CORE");
  });
});
