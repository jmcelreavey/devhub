/**
 * General skill/agent sync must not recreate files for a plugin that was
 * disabled after the catalog was built, and must not run into a plugin
 * operation that is part-way through its writes.
 */
import fs from "node:fs";
import path from "node:path";
import { resolvePluginPaths } from "./paths";
import { listEnabledPlugins } from "./registry";
import { readRegistryFile } from "./registry-write";
import { pluginContext } from "./context";
import { readReceipt, ID_RE } from "./store";

function isManaged(name: string): boolean {
  try {
    return readRegistryFile().plugins.some((entry) => entry.name === name && entry.managed === true);
  } catch {
    return true;
  }
}

async function enabledNow(name: string): Promise<boolean> {
  // A general sync has no reviewed target plan. Managed copies are changed
  // only through Plugins; otherwise it would overwrite edits and add targets
  // absent from the installation receipt.
  return !isManaged(name) && listEnabledPlugins().some((plugin) => plugin.name === name);
}

/** Called under the mutation lock, including receipts retained after removal. */
export function managedTargetPaths(): Set<string> {
  const ctx = pluginContext();
  const protectedPaths = new Set<string>();
  const dir = path.join(resolvePluginPaths().pluginHome, "receipts");
  if (!fs.existsSync(dir)) return protectedPaths;
  for (const file of fs.readdirSync(dir)) {
    const id = file.replace(/\.json$/, "");
    if (!ID_RE.test(id)) continue;
    const receipt = readReceipt(ctx, id);
    if (!receipt) throw new Error("A plugin installation record is unreadable. Review Plugins before syncing.");
    for (const target of [...receipt.files.map((item) => item.destination), ...(receipt.retainedPaths ?? [])]) protectedPaths.add(path.resolve(target));
  }
  return protectedPaths;
}

/**
 * One verdict per plugin per sync run: the first asset from a managed plugin
 * waits for any running operation and re-reads the registry; the rest reuse it.
 */
export function pluginOriginGuard(): (origin: string) => Promise<boolean> {
  const verdicts = new Map<string, Promise<boolean>>();
  return (origin) => {
    if (!origin.startsWith("plugin:")) return Promise.resolve(true);
    let verdict = verdicts.get(origin);
    if (!verdict) {
      verdict = enabledNow(origin.slice("plugin:".length));
      verdicts.set(origin, verdict);
    }
    return verdict;
  };
}
