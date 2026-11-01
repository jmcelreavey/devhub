/**
 * Dashboard wrapper around `scripts/devhub-update.sh` — the "Pull core updates" action.
 *
 * Runs the canonical shell script (single source of truth for the unrelated-history
 * `git apply --3way` pull) as a subprocess and streams its output to the SSE log. We
 * deliberately do NOT re-implement the pull in TypeScript: the script is the contract,
 * and porting it would create a second copy that drifts.
 *
 * Only the safe *pull* direction is exposed in the UI. Pushing back upstream (backport)
 * stays a deliberate terminal action — see the `devhub-fork-workflow` skill.
 */
import { execExternal } from "./exec-external";
import { withRepoGitMutation } from "./git/mutation-queue";
import path from "node:path";
import { augmentedPathEnv, terminalShellEnv } from "../local/process-env";

type Emit = (line: string) => void;

export interface PullCoreOptions {
  emit: Emit;
  repoRoot: string;
  /** When true, runs with --dry-run: shows incoming commits + diff, changes nothing. */
  dryRun?: boolean;
}

/** Spawn `bash scripts/devhub-update.sh [--dry-run]`, stream output, resolve exit code. */
export async function pullCore({ emit, repoRoot, dryRun }: PullCoreOptions): Promise<number> {
  const script = path.join("scripts", "devhub-update.sh");
  const args = [script, "--no-sync", ...(dryRun ? ["--dry-run"] : [])];
  emit(`$ bash ${args.join(" ")}`);

  const stream = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      const trimmed = line.replace(/\s+$/, "");
      if (trimmed) emit(trimmed);
    }
  };
  const options = {
    cwd: repoRoot,
    env: terminalShellEnv(augmentedPathEnv()) as NodeJS.ProcessEnv,
    timeoutMs: 300_000,
    onStdout: stream,
  };
  try {
    await withRepoGitMutation(repoRoot, async () => {
      const result = await execExternal("bash", args, options);
      if (result.stderr) stream(Buffer.from(result.stderr));
    });
    // The canonical script's post-pull steps run after releasing the Git lease;
    // asset sync can launch its own Git commands in another process.
    if (!dryRun) {
      const cli = path.join(path.dirname(require.resolve("tsx/package.json")), "dist/cli.mjs");
      for (const action of ["validate", "sync"]) {
        const result = await execExternal(process.execPath, [cli, "../core/src/scripts/run-action.ts", action], { ...options, cwd: path.join(repoRoot, "apps/ui") });
        if (result.stderr) stream(Buffer.from(result.stderr));
      }
    }
    return 0;
  } catch (error) {
    emit(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
