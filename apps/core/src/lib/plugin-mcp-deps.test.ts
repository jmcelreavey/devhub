import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { pluginMcpServerDirs } from "./plugin-mcp-deps";
import { pluginRegistryPath } from "./plugins/registry";

it("keeps bootstrap installs out of reviewed snapshots while discovering local MCP packages", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-mcp-deps-"));
  try {
    const entries = [false, true].map((managed) => {
      const name = managed ? "reviewed" : "local";
      const root = path.join(home, name);
      const server = path.join(root, "mcp-servers", "tools");
      fs.mkdirSync(server, { recursive: true });
      fs.writeFileSync(path.join(root, "devhub-plugin.json"), JSON.stringify({ name, version: "1.0.0", devhubApi: "1", contributes: {} }));
      fs.writeFileSync(path.join(server, "package.json"), "{}");
      return { name, path: root, enabled: true, managed };
    });
    const registry = pluginRegistryPath(home);
    fs.mkdirSync(path.dirname(registry), { recursive: true });
    fs.writeFileSync(registry, JSON.stringify({ plugins: entries }));
    expect(pluginMcpServerDirs(home)).toEqual([
      { plugin: "local", dir: path.join(home, "local", "mcp-servers", "tools"), hasNodeModules: false },
    ]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
