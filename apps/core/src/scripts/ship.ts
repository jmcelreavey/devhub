#!/usr/bin/env tsx
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execExternal } from "../lib/exec-external";
import { resolveGitCommonDir, withRepoGitMutation } from "../lib/git/mutation-queue";
import { expandHome } from "../lib/plugins/registry";
import { augmentedPathEnv, terminalShellEnv } from "@devhub/core/local/process-env";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const args = process.argv.slice(2);
const preview = args.includes("--dry-run");
// Ship spans the mirror and its enabled plugins. A stable order avoids two
// workflows each holding one repository while waiting for the other.
// Match the shell's registry entries, including repos with an invalid manifest:
// the shell still commits those, so they must take the queue as well.
function pluginRepositories(): string[] {
  const registry = path.join(os.homedir(), ".config/devhub/plugins.json");
  if (!fs.existsSync(registry)) return [];
  const parsed = JSON.parse(fs.readFileSync(registry, "utf8")) as { plugins?: Array<{ path?: unknown; enabled?: unknown }> };
  if (!Array.isArray(parsed.plugins)) throw new Error("Invalid plugin registry");
  return parsed.plugins.filter((entry) => entry.enabled !== false && typeof entry.path === "string")
    .map((entry) => expandHome(entry.path as string));
}
const roots = [repoRoot, ...(preview ? [] : pluginRepositories())];
const repositories = [...new Set(roots.map(resolveGitCommonDir))].sort();

async function locked(index: number): Promise<void> {
  if (index < repositories.length) {
    return withRepoGitMutation(repositories[index], () => locked(index + 1));
  }
  const result = await execExternal("bash", [path.join(repoRoot, "scripts/devhub-ship.sh"), ...args], {
    cwd: repoRoot,
    env: terminalShellEnv(augmentedPathEnv()) as NodeJS.ProcessEnv,
    timeoutMs: preview ? 60_000 : 60 * 60_000,
    onStdout: (chunk) => { process.stdout.write(chunk); },
  });
  if (result.stderr) process.stderr.write(result.stderr);
}

locked(0).catch((error: unknown) => {
  const failure = error as { stderr?: string; message?: string };
  process.stderr.write(`[devhub-ship] SHIP FAILED: ${failure.stderr || failure.message || String(error)}\n`);
  process.exitCode = 1;
});
