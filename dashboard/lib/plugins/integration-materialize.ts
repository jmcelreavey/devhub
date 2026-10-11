import fs from "node:fs";
import path from "node:path";
import { execExternal } from "@/lib/exec-external";
import { listEnabledPlugins } from "./registry";
import { collectPluginDbProviders, type CollectedProvider, type DbMaterializeOptions } from "./db-materialize";

export function integrationSource(providers: CollectedProvider[]): string {
  return '/* Generated from dashboard.providers; empty baseline works without plugins. */\nimport type { IntegrationProvider } from "./integrations/types";\n'
    + providers.map((p) => "import " + p.binding + " from " + JSON.stringify(p.specifier) + ";\n").join("")
    + "\nexport const PLUGIN_INTEGRATIONS: IntegrationProvider[] = [" + providers.map((p) => "..." + p.binding).join(", ") + "];\n";
}
export async function materializeIntegrationProviders(opts: DbMaterializeOptions): Promise<number> {
  const { providers, errors } = collectPluginDbProviders(listEnabledPlugins(opts.home, opts.emit), "providers");
  for (const error of errors) opts.emit(error.replaceAll("dashboard.connections", "dashboard.providers"));
  if (errors.length) return 1;
  if (opts.dryRun) { opts.emit("integrations: would register " + providers.length + " source modules"); return 0; }
  const relative = "dashboard/lib/plugin-integrations.generated.ts";
  // Hide the generated imports before writing, so an untracked baseline cannot leak plugin code into a commit.
  if (providers.length) {
    try { await execExternal("git", ["update-index", "--skip-worktree", relative], { cwd: opts.repoRoot, timeoutMs: 10000 }); }
    catch { opts.emit("integrations: commit the empty generated baseline before enabling providers"); return 1; }
  }
  fs.writeFileSync(path.join(opts.repoRoot, relative), integrationSource(providers));
  if (!providers.length) {
    try { await execExternal("git", ["update-index", "--no-skip-worktree", relative], { cwd: opts.repoRoot, timeoutMs: 10000 }); }
    catch { /* A new, empty baseline is safe to leave visible before its first commit. */ }
  }
  opts.emit("integrations: " + providers.length + " source modules; rebuild to apply changes");
  return 0;
}
