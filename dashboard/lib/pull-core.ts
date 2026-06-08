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
import { spawn } from "node:child_process";
import path from "node:path";

type Emit = (line: string) => void;

export interface PullCoreOptions {
  emit: Emit;
  repoRoot: string;
  /** When true, runs with --dry-run: shows incoming commits + diff, changes nothing. */
  dryRun?: boolean;
}

/** Spawn `bash scripts/devhub-update.sh [--dry-run]`, stream output, resolve exit code. */
export function pullCore({ emit, repoRoot, dryRun }: PullCoreOptions): Promise<number> {
  const script = path.join("scripts", "devhub-update.sh");
  const args = [script, ...(dryRun ? ["--dry-run"] : [])];
  emit(`$ bash ${args.join(" ")}`);

  const child = spawn("bash", args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
  });

  const stream = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      const trimmed = line.replace(/\s+$/, "");
      if (trimmed) emit(trimmed);
    }
  };
  child.stdout?.on("data", stream);
  child.stderr?.on("data", stream);

  return new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      emit(`ERROR: ${err.message}`);
      resolve(1);
    });
  });
}
