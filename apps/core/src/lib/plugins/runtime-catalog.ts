import path from "node:path";
import { PluginApiError, toolEnv, type PluginContext } from "./context";
import { assertSafePath } from "./filesystem";
import { hashFile, hashSkillDir, walkPluginRoot } from "./inspect";
import { readManifest } from "./manifest";
import { expandHome } from "./registry";
import { readReceipt } from "./store";
import { runtimeApproval } from "./install";
import { rows, findEntry } from "./views";
import { verifyRuntimeFiles } from "./runtime-files";
import type { PluginNavItem } from "./types";
import type { RuntimeContribution } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { whichOnPath } from "./runtime";

export interface LoadedRuntime {
  id: string;
  name: string;
  root: string;
  revision: string;
  runtime: RuntimeContribution;
  commandDirectories: string[];
  navigation?: PluginNavItem[];
}

export function loadRuntime(ctx: PluginContext, name: string): LoadedRuntime {
  const entry = findEntry(ctx, name);
  if (!entry?.enabled || !entry.managed) throw new PluginApiError(404, "RUNTIME_DISABLED", "This runtime plugin is not enabled.");
  const root = expandHome(entry.path, ctx.home);
  assertSafePath(ctx.paths.pluginHome, root);
  if (!root.startsWith(path.join(ctx.paths.pluginHome, "repos") + path.sep)) throw new Error("Runtime is outside managed storage");
  const receipt = readReceipt(ctx, entry.id);
  const approval = runtimeApproval(receipt, root);
  const manifest = readManifest(root);
  if (!approval || !manifest.ok || !manifest.manifest.runtime || manifest.manifest.name !== entry.name || approval.sha !== entry.sha) throw new PluginApiError(409, "RUNTIME_CONSENT", "Review this runtime plugin before enabling it.");
  if (walkPluginRoot(root).length || hashFile(path.join(root, "devhub-plugin.json")) !== approval.manifestHash || hashSkillDir(root) !== approval.treeHash) throw new PluginApiError(409, "RUNTIME_CHANGED", "Runtime files changed. Review the plugin again before running it.");
  verifyRuntimeFiles(root, manifest.manifest.runtime);
  const commandEnv = toolEnv(ctx);
  const commandDirectories = (manifest.manifest.requires?.commands ?? []).map(({ command }) => {
    const executable = whichOnPath(command, commandEnv);
    if (!executable) throw new PluginApiError(409, "RUNTIME_COMMAND", "A required plugin command is missing. Re-check requirements in Plugins.");
    return path.dirname(executable);
  });
  for (const command of manifest.manifest.runtime.permissions.commands ?? []) {
    const executable = whichOnPath(command, commandEnv);
    if (executable) commandDirectories.push(path.dirname(executable));
  }
  const orderedDirectories = (commandEnv.PATH ?? "").split(path.delimiter).filter((directory) => commandDirectories.includes(directory));
  return {
    id: entry.id, name: entry.name, root, revision: approval.treeHash, runtime: manifest.manifest.runtime,
    navigation: manifest.manifest.runtime.nav?.map(item => ({ ...item, gate: item.gate ?? manifest.manifest.navGate })),
    commandDirectories: [...new Set([...orderedDirectories, ...commandDirectories])],
  };
}

export function runtimeCatalog(ctx: PluginContext): LoadedRuntime[] {
  return rows(ctx).flatMap((row) => {
    if (!row.enabled || !row.managed) return [];
    try { return [loadRuntime(ctx, row.name)]; }
    catch { return []; } // The Plugins page still lists invalid registrations.
  });
}
export interface RuntimeRequest {
  kind: "page" | "api" | "mcp" | "database" | "integration" | "slot";
  path: string;
  method: string;
  body?: unknown;
}

