#!/usr/bin/env tsx
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  cancelOperation,
  pluginContext,
  startPrepare,
  waitForOperation,
  type PluginContext,
} from "../lib/plugins/operations";
import { registerPlugin, setPluginEnabled } from "../lib/plugins/registry-write";
import { aliasHome } from "../lib/plugins/runtime";
import { renderPluginTemplate, writePluginTemplate, type TemplateOptions } from "../lib/plugins/templates";
import { describeRegistrations } from "../lib/plugins/views";

const usage = [
  "Usage:",
  "  npm run plugins -- add <path>",
  "  npm run plugins -- enable <name>",
  "  npm run plugins -- disable <name>",
  "  npm run plugins -- list [--all] [--json]",
  "  npm run plugins -- new <name> --out <path> [--dry-run] [--description <text>] [--branding] [--brand-name <name>] [--primary <#hex>] [--accent <#hex>]",
  "  npm run plugins -- add-from-url <https://github.com/owner/repo>",
].join("\n");

export interface CliIo {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
}

/** `npm --prefix` changes the working directory; paths still mean where the person ran the command. */
function callerPath(value: string, env: NodeJS.ProcessEnv): string {
  return path.resolve(env.INIT_CWD ?? process.cwd(), value);
}

export async function runPluginsCli(argv: string[], io: CliIo, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === "list") return listCommand(rest, io, env);
    if (command === "new") return newCommand(rest, io, env);
    if (command === "add-from-url") return await urlCommand(rest, io, env);
    if (command === "add" || command === "enable" || command === "disable") {
      if (rest.length !== 1 || !rest[0]) throw new Error(usage);
      return await mutate(command, rest[0], io, env);
    }
    throw new Error(usage);
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function mutate(command: "add" | "enable" | "disable", value: string, io: CliIo, env: NodeJS.ProcessEnv): Promise<number> {
  const home = os.homedir();
  if (command === "add") {
    const localPath = value === "~" || value.startsWith("~/") ? value : callerPath(value, env);
    const plugin = await registerPlugin(localPath, home, env);
    io.stdout(`Enabled ${plugin.name}: ${plugin.path}\n`);
  } else {
    const plugin = await setPluginEnabled(value, command === "enable", home, env);
    io.stdout(`${plugin.enabled ? "Enabled" : "Disabled"} ${plugin.name}\n`);
  }
  io.stdout(`Saved ${pluginContext({ env }).paths.registryPath}\nRestart the dashboard to apply the change. Use Skills → Sync to publish the plugin's skills, agents and MCP definitions to your AI tools.\n`);
  return 0;
}

function listCommand(rest: string[], io: CliIo, env: NodeJS.ProcessEnv): number {
  const flags = new Set(rest);
  if ([...flags].some((flag) => flag !== "--all" && flag !== "--json")) throw new Error(usage);
  const all = flags.has("--all");
  const ctx = pluginContext({ env });
  const { facts, problem } = describeRegistrations(ctx);
  if (problem) io.stderr(`${problem}\n`);
  // Without --all this is the list it has always been: enabled plugins that load.
  const shown = facts.filter(({ item }) => all || item.state === "enabled" || item.state === "local");

  if (flags.has("--json")) {
    const rows = shown.map(({ item, row, abs, version }) => ({
      name: item.name,
      version,
      state: item.state,
      enabled: row.enabled,
      managed: item.managed,
      attention: item.attention,
      // Never the full home path, and never credentials: a source is a public GitHub address or a folder alias.
      path: aliasHome(abs, ctx.home),
      source: row.url,
    }));
    io.stdout(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }
  if (!shown.length) io.stdout(all ? "No plugins.\n" : "No enabled plugins.\n");
  for (const { item, abs, version } of shown) {
    io.stdout(all
      ? `${item.name}  ${item.stateLabel.toLowerCase()}${item.attention ? ` (${item.attention})` : ""}  ${abs}\n`
      : `${item.name}  ${version ?? "unknown"}  ${abs}\n`);
  }
  return 0;
}

function newCommand(rest: string[], io: CliIo, env: NodeJS.ProcessEnv): number {
  const name = rest[0];
  if (!name || name.startsWith("--")) throw new Error(usage);
  const out = flagValue(rest, "--out");
  if (!out) throw new Error("new requires --out <path>");
  const dest = callerPath(out, env);
  const opts: TemplateOptions = {
    name,
    description: flagValue(rest, "--description"),
    branding: rest.includes("--branding"),
    brandName: flagValue(rest, "--brand-name"),
    primary: flagValue(rest, "--primary"),
    accent: flagValue(rest, "--accent"),
  };
  if (rest.includes("--dry-run")) {
    const files = renderPluginTemplate(opts);
    io.stdout(`Would create ${files.length} files in ${dest}\n`);
    for (const file of files) io.stdout(`${file.path}\n`);
    return 0;
  }
  const written = writePluginTemplate(dest, opts);
  io.stdout(`Created ${dest}\n`);
  for (const file of written) io.stdout(`${file}\n`);
  io.stdout("Nothing was registered or published. To try it here: npm run plugins -- add " + dest + "\n");
  return 0;
}

/** Reviews a repository the way the Plugins page does, and stops there: confirming is an in-app step. */
async function urlCommand(rest: string[], io: CliIo, env: NodeJS.ProcessEnv): Promise<number> {
  const url = rest[0];
  if (!url || rest.length !== 1) throw new Error(usage);
  const ctx: PluginContext = pluginContext({ env });
  const started = startPrepare(ctx, url);
  const view = await waitForOperation(ctx, started.id, 120_000);
  try {
    if (view.message) io.stdout(`${view.message}\n`);
    if (view.preview?.body) io.stdout(`${view.preview.body}\n`);
    for (const issue of view.issues) io.stdout(`  ${issue.file}${issue.field ? ` ${issue.field}` : ""}: ${issue.message}\n`);
    if (view.state === "ready" && view.preview?.canApply) {
      const { skills, agents } = view.preview.contributions;
      io.stdout(`Review ready for ${view.preview.plugin?.name ?? "plugin"}: ${skills.length} skills, ${agents.length} agents. Nothing was enabled.\n`);
      return 0;
    }
    io.stdout("Nothing was registered.\n");
    return 1;
  } finally {
    // A review belongs to this process; leave nothing downloaded behind.
    await cancelOperation(ctx, view.id).catch(() => undefined);
  }
}

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runPluginsCli(process.argv.slice(2), {
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
  }).then((code) => {
    process.exitCode = code;
  });
}
