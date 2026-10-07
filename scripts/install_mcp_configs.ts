#!/usr/bin/env tsx
/**
 * Backward-compatible delegator. The real implementation lives in
 * `dashboard/lib/sync/mcp.ts` (in-process so the dashboard Sync MCP button
 * and bootstrap-install can share it). Keep this file around so anyone still
 * running `npx tsx scripts/install_mcp_configs.ts` gets the same result.
 *
 * With no flags it syncs every tool and prunes, as it always has. Flags narrow it:
 *
 *   --tool <id>       only this tool (repeatable)
 *   --exclude <name>  never write or prune this server (repeatable) — the Codex
 *                     app ships `node_repl` and `computer-use` itself, and a
 *                     prune can't tell them from ours
 *   --no-prune        add and update servers, remove nothing
 *   --dry-run         say what would change
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncMcpServers } from "../dashboard/lib/sync/mcp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

function parseArgs(argv: string[]): { tools: string[]; exclude: string[]; prune: boolean; dryRun: boolean } {
  const tools: string[] = [];
  const exclude: string[] = [];
  let prune = true;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tool" && argv[i + 1]) tools.push(argv[++i]);
    else if (arg === "--exclude" && argv[i + 1]) exclude.push(argv[++i]);
    else if (arg === "--no-prune") prune = false;
    else if (arg === "--dry-run") dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { tools, exclude, prune, dryRun };
}

async function main(): Promise<number> {
  const { tools, exclude, prune, dryRun } = parseArgs(process.argv.slice(2));
  const emit = (line: string) => process.stdout.write(`${line}\n`);
  let worst = 0;
  // `tool` takes one id, so a list is a run per tool; no list is the one run over all of them.
  for (const tool of tools.length > 0 ? tools : [undefined]) {
    const code = await syncMcpServers({ emit, repoRoot: REPO_ROOT, prune, dryRun, excludeServers: exclude, tool });
    worst = Math.max(worst, code);
  }
  return worst;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
