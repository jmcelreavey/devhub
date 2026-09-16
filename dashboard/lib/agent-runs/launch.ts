import fs from "node:fs";
import path from "node:path";
import { getCheckoutRoot } from "@/lib/desktop/runtime-paths";
import { shellQuote } from "@/lib/shell-quote";

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
    if (fs.existsSync(bundled)) return [process.execPath, bundled, ...flags, runDir].map(shellQuote).join(" ");
  }

  const checkout = getCheckoutRoot();
  const dashboardDirs = [process.cwd(), checkout ? path.join(checkout, "dashboard") : null];
  for (const dir of dashboardDirs) {
    if (!dir) continue;
    const tsx = path.join(dir, "node_modules", ".bin", "tsx");
    const script = path.join(dir, "scripts", "agent-run.ts");
    if (fs.existsSync(tsx) && fs.existsSync(script)) return [tsx, script, ...flags, runDir].map(shellQuote).join(" ");
  }
  throw new Error(
    "Agent runner not found: expected services/agent-run.cjs (desktop) or dashboard/scripts/agent-run.ts with tsx installed.",
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
