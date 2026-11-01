/**
 * Last-line guard on tool result size. Harnesses cap MCP results themselves
 * (Claude Code at ~25k tokens) and either error or cut blind, so a single
 * oversized call — a whole-repo diff came back at ~950k chars — burns the
 * turn without telling the agent how to ask for less. Tools should shape their
 * own output; this only catches the ones that do not, and says so.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** ~22k tokens: under the common harness limit with room for the notice. */
export const MAX_RESULT_CHARS = 90_000;

type AnyToolCallback = (...args: unknown[]) => unknown;

interface ResultLike {
  content?: Array<{ type: string; text?: string }>;
}

export function capToolResult<T>(result: T, limit = MAX_RESULT_CHARS): T {
  const content = (result as ResultLike | undefined)?.content;
  if (!Array.isArray(content)) return result;
  const total = content.reduce((n, part) => n + (part.type === "text" ? (part.text?.length ?? 0) : 0), 0);
  if (total <= limit) return result;

  let budget = limit;
  const capped = content.map((part) => {
    if (part.type !== "text" || typeof part.text !== "string") return part;
    const text = part.text.slice(0, Math.max(0, budget));
    budget -= text.length;
    return { ...part, text };
  });
  const notice =
    `\n\n[DevHub MCP: result truncated to ${limit} of ${total} chars. ` +
    "Narrow the call (a path, date, query, limit or filter argument) to see the rest.]";
  const lastText = capped.map((p) => p.type).lastIndexOf("text");
  if (lastText >= 0) {
    const part = capped[lastText] as { type: string; text: string };
    capped[lastText] = { ...part, text: part.text + notice };
  }
  return { ...(result as object), content: capped } as T;
}

/**
 * Verbatim reads an agent edits and writes back. Truncating these would turn a
 * read-modify-write into silent data loss, so they return whole.
 */
export const UNCAPPED_TOOLS: ReadonlySet<string> = new Set([
  "notes_read",
  "docs_read",
  "diagrams_read",
  "skills_read",
  "tasks_plan_markdown",
  "repos_git_conflicts",
]);

/** Wrap every tool registered after this call so its result passes through capToolResult. */
export function instrumentOutputCap(server: McpServer, limit = MAX_RESULT_CHARS): void {
  const register = server.registerTool.bind(server) as (name: string, config: unknown, cb: AnyToolCallback) => unknown;
  const patched = (name: string, config: unknown, cb: AnyToolCallback) =>
    UNCAPPED_TOOLS.has(name)
      ? register(name, config, cb)
      : register(name, config, async (...args: unknown[]) => capToolResult(await cb(...args), limit));
  (server as unknown as { registerTool: typeof patched }).registerTool = patched;
}
