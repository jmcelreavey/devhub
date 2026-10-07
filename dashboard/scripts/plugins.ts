#!/usr/bin/env tsx
import path from "node:path";
import process from "node:process";
import { listEnabledPlugins, pluginRegistryPath } from "../lib/plugins/registry";
import { registerPlugin, setPluginEnabled } from "../lib/plugins/registry-write";

const usage = "Usage: npm run plugins -- <add path | enable name | disable name | list>";

async function main(): Promise<void> {
  const [command, value, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error(usage);
  if (command === "list" && !value) {
    const plugins = listEnabledPlugins(undefined, message => process.stderr.write(message + "\n"));
    if (!plugins.length) process.stdout.write("No enabled plugins.\n");
    for (const plugin of plugins) {
      process.stdout.write(`${plugin.name}  ${plugin.manifest.version}  ${plugin.path}\n`);
    }
    return;
  }
  if (!value || !["add", "enable", "disable"].includes(command ?? "")) throw new Error(usage);
  if (command === "add") {
    // npm --prefix changes cwd; paths still refer to where the user ran the command.
    const localPath = value === "~" || value.startsWith("~/")
      ? value
      : path.resolve(process.env.INIT_CWD ?? process.cwd(), value);
    const plugin = await registerPlugin(localPath);
    process.stdout.write(`Enabled ${plugin.name}: ${plugin.path}\n`);
  } else {
    const plugin = await setPluginEnabled(value, command === "enable");
    process.stdout.write(`${plugin.enabled ? "Enabled" : "Disabled"} ${plugin.name}\n`);
  }
  process.stdout.write(`Saved ${pluginRegistryPath()}\nRestart the dashboard to apply the change. Use Skills → Sync to publish the plugin's skills, agents and MCP definitions to your AI tools.\n`);
}

main().catch(error => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
