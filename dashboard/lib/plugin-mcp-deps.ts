/**
 * Discover plugin-contributed MCP server packages so bootstrap/health-check can
 * install their dependencies — a plugin's stdio MCP server (e.g. the BI plugin's
 * `mcp-servers/devhub-bi-server`) needs its own `node_modules`, just like core's
 * `mcp-servers/devhub-server`.
 *
 * Convention: a plugin ships its servers under `<pluginRoot>/mcp-servers/<name>/`,
 * each a node package with a `package.json`. The plugin's `mcp/<name>.json` config
 * points its `command` at that dir via the `PLUGIN_ROOT` placeholder.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listEnabledPlugins } from "./plugins/registry";

export interface PluginMcpServerDir {
  plugin: string;
  /** Absolute path to the server package (contains package.json). */
  dir: string;
  hasNodeModules: boolean;
}

/** All MCP server packages contributed by enabled plugins (those with a package.json). */
export function pluginMcpServerDirs(home = os.homedir()): PluginMcpServerDir[] {
  const out: PluginMcpServerDir[] = [];
  for (const plugin of listEnabledPlugins(home)) {
    const serversRoot = path.join(plugin.path, "mcp-servers");
    if (!fs.existsSync(serversRoot)) continue;
    for (const entry of fs.readdirSync(serversRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(serversRoot, entry.name);
      if (!fs.existsSync(path.join(dir, "package.json"))) continue;
      out.push({ plugin: plugin.name, dir, hasNodeModules: fs.existsSync(path.join(dir, "node_modules")) });
    }
  }
  return out;
}
