import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";

/**
 * "Ship everything to main" — wraps scripts/devhub-ship.sh: commits notes/tasks
 * and code as separate commits, pushes origin main, ports the content diff to
 * the public core's main directly (leak scan gates; no PR), and pushes enabled
 * plugin repos. The pre-push verify makes a run take several minutes, so
 * `repo_ship` starts it detached and `repo_ship_status` polls the log.
 */

const LOG_PATH = path.join(os.tmpdir(), "devhub-ship.log");

function repoRoot(): string {
  const sourceDir = path.dirname(fileURLToPath(import.meta.url));
  return process.env.REPO_ROOT || path.resolve(sourceDir, "../../../..");
}

function shipRunning(): boolean {
  const res = spawnSync("pgrep", ["-f", "devhub-ship.sh"], { encoding: "utf-8" });
  return res.status === 0 && res.stdout.trim().length > 0;
}

export function registerShipTools(server: McpServer, _ctx: Context): void {
  server.registerTool(
    "repo_ship",
    {
      description:
        "Ship all local DevHub work: commit notes/tasks + code, push the private mirror (origin main), port the content diff straight to the public core's main (leak-scanned, personal paths dropped, no PR), and push enabled plugin repos. Runs detached (verify takes minutes) — poll repo_ship_status. Use dryRun to preview what would be committed.",
      inputSchema: {
        message: z.string().optional().describe("Feature commit message (default 'chore: ship local work')"),
        dryRun: z.boolean().optional().describe("Preview the changed paths without committing or pushing"),
        includeUpstream: z
          .boolean()
          .optional()
          .describe("Also push the public core (default true); false = private + plugins only"),
      },
    },
    async ({ message, dryRun, includeUpstream }) => {
      const root = repoRoot();
      const script = path.join(root, "scripts", "devhub-ship.sh");
      if (!fs.existsSync(script)) {
        return { content: [{ type: "text", text: `devhub-ship.sh not found at ${script}` }], isError: true };
      }
      const args = [script];
      if (message?.trim()) args.push(message.trim());
      if (dryRun) args.push("--dry-run");
      if (includeUpstream === false) args.push("--no-upstream");

      if (dryRun) {
        const res = spawnSync("bash", args, { cwd: root, encoding: "utf-8", timeout: 60_000 });
        const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
        return { content: [{ type: "text", text: out || "(no output)" }], isError: res.status !== 0 };
      }

      if (shipRunning()) {
        return {
          content: [{ type: "text", text: "A ship run is already in progress — check repo_ship_status." }],
          isError: true,
        };
      }

      fs.writeFileSync(LOG_PATH, "");
      const child = spawn("bash", args, {
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
    },
  );

  server.registerTool(
    "repo_ship_status",
    {
      description:
        "Status of the current/last repo_ship run: running/done/failed plus the tail of its log.",
      inputSchema: {
        lines: z.number().int().min(1).max(200).optional().describe("Log lines to return (default 25)"),
      },
    },
    async ({ lines }) => {
      const n = lines ?? 25;
      let tail = "";
      try {
        const all = fs.readFileSync(LOG_PATH, "utf-8").trimEnd().split("\n");
        tail = all.slice(-n).join("\n");
      } catch {
        return { content: [{ type: "text", text: "No ship log yet — run repo_ship first." }] };
      }
      const running = shipRunning();
      const state = running
        ? "RUNNING"
        : tail.includes("SHIP DONE")
          ? "DONE"
          : tail.includes("SHIP FAILED")
            ? "FAILED"
            : "UNKNOWN (not running; no completion marker)";
      return { content: [{ type: "text", text: `State: ${state}\n\n${tail}` }] };
    },
  );
}
