#!/usr/bin/env tsx
/**
 * `npx tsx scripts/run-action.ts <action> [flags]` — CLI entrypoint for the same
 * sync/validate flows the dashboard runs in-process. Used by the repo-root scripts
 * (devhub-update.sh) and for headless/CI use.
 *
 * Actions:
 *   validate                 Repo integrity checks (lib/validate.ts)
 *   sync                     Sync skills + agents + MCP + persona to local tools
 *   update_and_sync          Full update+sync orchestrator (origin); flags: --push --force
 *
 * Common flags: --dry-run
 */
import { getRepoRoot } from "../lib/content-dirs";
import { validateRepo } from "../lib/validate";
import { updateAndSync } from "../lib/sync-orchestrator";
import { syncSkills } from "../lib/sync-skills";
import { syncAgents } from "../lib/sync-agents";
import { syncMcpServers } from "../lib/sync-mcp";
import { syncPersona } from "../lib/sync-persona";
import { materializePlugins } from "../lib/plugins/materialize";
import { materializeBranding } from "../lib/plugins/branding";
import { materializePluginNav } from "../lib/plugins/nav-materialize";

const ACTIONS = ["validate", "sync", "sync_plugins", "update_and_sync"] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: string): value is Action {
  return (ACTIONS as readonly string[]).includes(value);
}

async function runSync(repoRoot: string, dryRun: boolean): Promise<number> {
  const emit = (line: string) => console.log(line);
  let code = 0;
  for (const step of [
    () => Promise.resolve(materializePlugins({ emit, repoRoot, dryRun })),
    () => Promise.resolve(materializeBranding({ emit, repoRoot, dryRun })),
    () => Promise.resolve(materializePluginNav({ emit, repoRoot, dryRun })),
    () => syncSkills({ emit, repoRoot, dryRun }),
    () => syncAgents({ emit, repoRoot, dryRun }),
    () => syncMcpServers({ emit, repoRoot, dryRun }),
    () => syncPersona({ emit, repoRoot, dryRun }),
  ]) {
    code = (await step()) || code;
  }
  return code;
}

async function main(): Promise<void> {
  const [action, ...rest] = process.argv.slice(2);
  if (!action || !isAction(action)) {
    console.error(`Usage: run-action.ts <${ACTIONS.join(" | ")}> [--dry-run] [--push] [--force]`);
    process.exit(2);
  }
  const flags = new Set(rest);
  const dryRun = flags.has("--dry-run");
  const emit = (line: string) => console.log(line);
  const repoRoot = getRepoRoot();

  let code = 0;
  if (action === "validate") {
    code = await validateRepo({ emit, repoRoot });
  } else if (action === "sync") {
    code = await runSync(repoRoot, dryRun);
  } else if (action === "sync_plugins") {
    code = materializePlugins({ emit, repoRoot, dryRun });
    code = materializeBranding({ emit, repoRoot, dryRun }) || code;
    code = materializePluginNav({ emit, repoRoot, dryRun }) || code;
  } else {
    code = await updateAndSync({
      emit,
      repoRoot,
      dryRun,
      push: flags.has("--push"),
      force: flags.has("--force"),
    });
  }
  process.exit(code);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
