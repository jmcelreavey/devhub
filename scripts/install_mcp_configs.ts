#!/usr/bin/env tsx
/**
 * Backward-compatible delegator. The real implementation lives in
 * `dashboard/lib/sync-mcp.ts` (in-process so the dashboard Sync MCP button
 * and bootstrap-install can share it). Keep this file around so anyone still
 * running `npx tsx scripts/install_mcp_configs.ts` gets the same result.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncMcpServers } from "../dashboard/lib/sync-mcp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

async function main(): Promise<number> {
  const code = await syncMcpServers({
    emit: (line) => process.stdout.write(`${line}\n`),
    repoRoot: REPO_ROOT,
    prune: true,
  });
  return code;
}

main().then((code) => process.exit(code));
