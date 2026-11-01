import fs from "node:fs";
import path from "node:path";
import { getCheckoutRoot } from "../desktop/runtime-paths";
import { shellQuote } from "../../../../../packages/shared/ui-lib/shell-quote";
import { sqliteRunsEnabled } from "../../domains/storage/runs";

function runnerCommand(args: string[]): string {
  const command = args.map(shellQuote).join(" ");
  if (!sqliteRunsEnabled()) return command;
  const names = ["HOME", "XDG_STATE_HOME", "XDG_DATA_HOME", "DEVHUB_APP_DATA", "DEVHUB_DESKTOP", "DEVHUB_STATE_PROFILE", "DEVHUB_STORAGE_SQLITE"];
  return `env ${names.map((name) => `${name}=${shellQuote(process.env[name] ?? "")}`).join(" ")} ${command}`;
}

/**
 * The shell command a terminal tab runs to execute one agent run.
 *
 * Desktop: the esbuild bundle staged next to the PTY server, run with the
 * app's own node. Checkout: the TypeScript source through the dashboard's tsx.
 */
export function agentRunnerCommand(runDir: string, flags: string[] = []): string {
  const serverDir = process.env.DEVHUB_SERVER_DIR?.trim();
  if (serverDir) {
    const bundled = path.resolve(serverDir, "..", "services", "agent-run.cjs");
    if (fs.existsSync(bundled)) return runnerCommand([process.execPath, bundled, ...flags, runDir]);
  }

  const checkout = getCheckoutRoot();
  const roots = [checkout, path.resolve(process.cwd(), "../.."), process.cwd()];
  for (const root of roots) {
    if (!root) continue;
    const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
    const script = path.join(root, "apps/core/src/scripts/agent-run.ts");
    if (fs.existsSync(tsx) && fs.existsSync(script)) return runnerCommand([process.execPath, tsx, ...(sqliteRunsEnabled() ? ["--tsconfig", path.join(root, "apps/ui/tsconfig.json")] : []), script, ...flags, runDir]);
  }
  throw new Error(
    "Agent runner not found: expected services/agent-run.cjs (desktop) or apps/core/src/scripts/agent-run.ts with tsx installed.",
  );
}

/**
 * Shell fragments the dock wraps an interactive CLI with:
 * `${before}; <cli>; ${after}`. `$$`/`$?` expand in the tab's shell.
 */
export function interactiveRunWrap(runDir: string): { before: string; after: string } {
  return {
    before: `${agentRunnerCommand(runDir, ["--interactive-start"])} $$`,
    after: `__devhub_rc=$?; ${agentRunnerCommand(runDir, ["--interactive-finish"])} "$__devhub_rc"`,
  };
}
