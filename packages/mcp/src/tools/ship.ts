import { repoShip, repoShipStatus } from "../../../../packages/shared/actions/ship.ts";
import { registerAction } from "../actions/register.ts";
import type { DashboardToolResult } from "../dashboard-client.ts";
import { execExternal } from "../../../../apps/core/src/lib/exec-external.ts";
import { localOps } from "../../../../apps/core/src/local/ops/index.ts";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.ts";

/**
 * The dashboard CLI holds the shared Git queues while the shell workflow runs.
 * Confirmed runs are detached because pre-push verify takes several minutes.
 */

const LOG_PATH = path.join(os.tmpdir(), "devhub-ship.log");
const require = createRequire(import.meta.url);

function repoRoot(): string {
  const sourceDir = path.dirname(fileURLToPath(import.meta.url));
  return process.env.REPO_ROOT || path.resolve(sourceDir, "../../../..");
}

async function shipRunning(): Promise<boolean> {
  try {
    const result = await execExternal("pgrep", ["-f", "scripts/ship.ts|devhub-ship.sh"], { timeoutMs: 4_000 });
    return result.stdout.trim().length > 0;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

export function registerShipTools(server: McpServer, _ctx: Context): void {
  registerAction(server, repoShip, { execute: async ({ message, preview, includeUpstream }) => {
      const root = repoRoot();
      const script = path.join(root, "scripts", "devhub-ship.sh");
      if (!fs.existsSync(script)) {
        return { content: [{ type: "text", text: `devhub-ship.sh not found at ${script}` }], isError: true };
      }
      const args = [require.resolve("tsx/cli"), "--tsconfig", path.join(root, "apps/ui/tsconfig.json"), path.join(root, "apps/core/src/scripts/ship.ts")];
      if (message?.trim()) args.push(message.trim());
      if (preview) args.push("--dry-run");
      if (includeUpstream === false) args.push("--no-upstream");

      if (preview) {
        try {
          // Queue acquisition is bounded at twenty minutes; the CLI separately
          // caps execution at one minute and kills the Git process group.
          const res = await execExternal(process.execPath, args, { cwd: root, timeoutMs: 22 * 60_000, maxBuffer: 32 * 1024 * 1024 });
          const out = `${res.stdout}${res.stderr}`.trim();
          return { content: [{ type: "text", text: out || "(no output)" }], isError: false };
        } catch (error) {
          const failure = error as { stdout?: string; stderr?: string; message?: string };
          return { content: [{ type: "text", text: `${failure.stdout ?? ""}${failure.stderr ?? failure.message ?? "Ship preview failed"}`.trim() }], isError: true };
        }
      }

      if (await shipRunning()) {
        return {
          content: [{ type: "text", text: "A ship run is already in progress — check repo_ship_status." }],
          isError: true,
        };
      }

      fs.writeFileSync(LOG_PATH, "");
      const child = localOps.spawn(process.execPath, args, {
        cwd: root,
        detached: true,
        stdio: ["ignore", fs.openSync(LOG_PATH, "a"), fs.openSync(LOG_PATH, "a")],
      });
      child.unref();
      return {
        content: [
          {
            type: "text",
            text: `Ship started (pid ${child.pid}). Pre-push verify takes a few minutes — poll repo_ship_status. Log: ${LOG_PATH}`,
          },
        ],
      };
    } },
    (result) => result as DashboardToolResult);

  registerAction(server, repoShipStatus, { execute: async ({ lines }) => {
      const n = lines ?? 25;
      let tail = "";
      try {
        const all = fs.readFileSync(LOG_PATH, "utf-8").trimEnd().split("\n");
        tail = all.slice(-n).join("\n");
      } catch {
        return { content: [{ type: "text", text: "No ship log yet — run repo_ship first." }] };
      }
      const running = await shipRunning();
      const state = running
        ? "RUNNING"
        : tail.includes("SHIP DONE")
          ? "DONE"
          : tail.includes("SHIP FAILED")
            ? "FAILED"
            : "UNKNOWN (not running; no completion marker)";
      return { content: [{ type: "text", text: `State: ${state}\n\n${tail}` }] };
    } },
    (result) => result as DashboardToolResult);
}
