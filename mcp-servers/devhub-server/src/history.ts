/**
 * MCP-side half of the call history: the file recorder and the registerTool
 * hook. The format, redaction, reading and summaries live in
 * shared/mcp-history so the dashboard reads the same files the same way.
 *
 * Writing history must never break a tool call, so every failure here is
 * swallowed after one warning on stderr.
 */
import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  clipText,
  localDate,
  mcpHistoryDir,
  summarizeArgs,
  type McpHistoryEntry,
} from "../../../shared/mcp-history/index.ts";

export * from "../../../shared/mcp-history/index.ts";

export interface HistoryRecorder {
  record(entry: McpHistoryEntry): void;
}

const MAX_ERROR = 300;

/** Tools about the history are not recorded — reading the log shouldn't grow it. */
export const UNRECORDED_TOOLS: ReadonlySet<string> = new Set(["mcp_history", "mcp_history_summary"]);

interface ToolResultLike {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
}

function resultText(result: ToolResultLike | undefined): string {
  return (result?.content ?? [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

export function createFileRecorder(dir = mcpHistoryDir()): HistoryRecorder {
  let warned = false;
  return {
    record(entry) {
      try {
        // 0700/0600: arguments are redacted, but paths and titles are still personal.
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.appendFileSync(path.join(dir, `${localDate(entry.ts)}.jsonl`), `${JSON.stringify(entry)}\n`, {
          mode: 0o600,
        });
      } catch (err) {
        if (warned) return;
        warned = true;
        console.error(`MCP history: could not write to ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

type AnyToolCallback = (...args: unknown[]) => unknown;

/**
 * Record every tool registered after this call.
 *
 * Patching `registerTool` once is deliberate: the alternative is wrapping each
 * handler in every registrar file, and the first tool someone adds without the
 * wrapper silently disappears from the trace.
 */
export function instrumentToolHistory(
  server: McpServer,
  opts: { recorder: HistoryRecorder; currentToolset: () => string | null },
): void {
  const register = server.registerTool.bind(server) as (name: string, config: unknown, cb: AnyToolCallback) => unknown;

  const patched = (name: string, config: { inputSchema?: unknown }, cb: AnyToolCallback) => {
    if (UNRECORDED_TOOLS.has(name)) return register(name, config, cb);
    const toolset = opts.currentToolset();
    const wrapped: AnyToolCallback = async (...cbArgs) => {
      const ts = Date.now();
      const clientInfo = server.server.getClientVersion();
      const base = {
        ts,
        tool: name,
        toolset,
        // Tools without an inputSchema are invoked with (extra) only.
        args: summarizeArgs(config.inputSchema === undefined ? null : cbArgs[0]),
        client: clientInfo ? `${clientInfo.name} ${clientInfo.version}` : undefined,
        agentRunId: process.env.DEVHUB_AGENT_RUN_ID || undefined,
        pid: process.pid,
        cwd: process.cwd(),
      };
      try {
        const result = (await cb(...cbArgs)) as ToolResultLike | undefined;
        const text = resultText(result);
        opts.recorder.record({
          ...base,
          durationMs: Date.now() - ts,
          ok: result?.isError !== true,
          error: result?.isError ? clipText(text.split("\n")[0] ?? "", MAX_ERROR) : undefined,
          resultChars: text.length,
        });
        return result;
      } catch (err) {
        opts.recorder.record({
          ...base,
          durationMs: Date.now() - ts,
          ok: false,
          error: clipText(err instanceof Error ? err.message : String(err), MAX_ERROR),
          resultChars: 0,
        });
        throw err;
      }
    };
    return register(name, config, wrapped);
  };

  server.registerTool = patched as unknown as McpServer["registerTool"];
}
