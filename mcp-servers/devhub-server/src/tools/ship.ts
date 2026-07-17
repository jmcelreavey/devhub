import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";

/**
 * Wraps scripts/devhub-ship.sh. Calls preview synchronously unless mutation is
 * explicitly confirmed; confirmed runs are detached because pre-push verify
 * takes several minutes.
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
        "Preview shipping by default. With confirm=true, commit local work, reconcile newer public-core changes, push the private mirror, port the leak-scanned generic catalog patch to public main, and push enabled plugins. Runs detached — poll repo_ship_status.",
      inputSchema: {
        message: z.string().optional().describe("Feature commit message (default 'chore: ship local work')"),
        dryRun: z.boolean().optional().describe("Preview the actual public patch without committing or pushing"),
        confirm: z.boolean().optional().describe("Required (true) to commit or push; omitted/false previews safely"),
        includeUpstream: z
          .boolean()
          .optional()
          .describe("Also push the public core (default true); false = private + plugins only"),
      },
    },
    async ({ message, dryRun, confirm, includeUpstream }) => {
      const root = repoRoot();
      const script = path.join(root, "scripts", "devhub-ship.sh");
      if (!fs.existsSync(script)) {
        return { content: [{ type: "text", text: `devhub-ship.sh not found at ${script}` }], isError: true };
      }
      const args = [script];
      if (message?.trim()) args.push(message.trim());
      const preview = dryRun === true || confirm !== true;
      if (preview) args.push("--dry-run");
      if (includeUpstream === false) args.push("--no-upstream");

      if (preview) {
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
