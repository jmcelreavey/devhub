/**
 * General skill/agent sync must not recreate files for a plugin that was
 * disabled after the catalog was built, and must not run into a plugin
 * operation that is part-way through its writes.
 */
import { withPluginMutationLock } from "./lock";
import { resolvePluginPaths } from "./paths";
import { listEnabledPlugins } from "./registry";
import { readRegistryFile } from "./registry-write";

function isManaged(name: string): boolean {
  try {
    return readRegistryFile().plugins.some((entry) => entry.name === name && entry.managed === true);
  } catch {
    return false;
  }
}

async function enabledNow(name: string): Promise<boolean> {
  const enabled = () => listEnabledPlugins().some((plugin) => plugin.name === name);
  // Folders registered by path have no operations to wait for.
  if (!isManaged(name)) return enabled();
  return withPluginMutationLock(resolvePluginPaths().pluginHome, async () => enabled());
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
