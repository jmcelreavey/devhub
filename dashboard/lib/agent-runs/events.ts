/**
 * Normalised event stream for DevHub agent runs.
 *
 * Every agent CLI speaks its own wire format. The runner (scripts/agent-run.ts)
 * parses each stdout line into these events, prints a readable version into the
 * DevHub terminal tab, and appends the event to the run's events.jsonl so MCP
 * callers can page through it with a cursor.
 *
 * Pure — no Next or `@/` imports — because the runner is bundled on its own.
 */

export const AGENT_STREAM_FORMATS = [
  "claude-stream-json",
  "cursor-stream-json",
  "codex-json",
  "text",
] as const;
export type AgentStreamFormat = (typeof AGENT_STREAM_FORMATS)[number];

export type AgentRunEvent =
  | { type: "session"; sessionId: string; model?: string }
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input?: string }
  | { type: "tool_result"; ok: boolean; output?: string }
  | { type: "stderr"; text: string }
  | {
      type: "result";
      ok: boolean;
      text?: string;
      costUsd?: number;
      turns?: number;
      durationMs?: number;
    }
  | { type: "error"; message: string };

/** `seq` is the event's line index in events.jsonl — the cursor MCP callers page with. */
export type RecordedAgentRunEvent = AgentRunEvent & { seq: number; ts: number };

const MAX_TEXT = 8_000;
const MAX_SNIPPET = 400;

type Json = Record<string, unknown>;

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** One-line preview of a tool's input or output. */
export function snippet(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine ? clip(oneLine, MAX_SNIPPET) : undefined;
}

function contentBlocks(message: unknown): Json[] {
  if (!isObject(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isObject);
}

function textBlocks(message: unknown): AgentRunEvent[] {
  return contentBlocks(message).flatMap((block): AgentRunEvent[] =>
    block.type === "text" && typeof block.text === "string" && block.text.trim()
      ? [{ type: "text", text: clip(block.text, MAX_TEXT) }]
      : [],
  );
}

function sessionEvent(event: Json): AgentRunEvent[] {
  const sessionId = str(event.session_id);
  return event.subtype === "init" && sessionId
    ? [{ type: "session", sessionId, model: str(event.model) }]
    : [];
}

function resultEvent(event: Json): AgentRunEvent {
  const failedSubtype = typeof event.subtype === "string" && event.subtype !== "success";
  return {
    type: "result",
    ok: event.is_error !== true && !failedSubtype,
    text: str(event.result),
    costUsd: num(event.total_cost_usd),
    turns: num(event.num_turns),
    durationMs: num(event.duration_ms),
  };
}

/** Claude tool results are a string or an array of `{ type: "text", text }` blocks. */
function toolResultText(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((c) => (isObject(c) && typeof c.text === "string" ? c.text : "")).join(" ");
}

function parseClaudeEvent(event: Json): AgentRunEvent[] {
  switch (event.type) {
    case "system":
      return sessionEvent(event);
    case "assistant":
      return contentBlocks(event.message).flatMap((block): AgentRunEvent[] => {
        if (block.type === "tool_use") {
          return [{ type: "tool_call", name: str(block.name) ?? "tool", input: snippet(block.input) }];
        }
        return textBlocks({ content: [block] });
      });
    case "user":
      return contentBlocks(event.message).flatMap((block): AgentRunEvent[] =>
        block.type === "tool_result"
          ? [{ type: "tool_result", ok: block.is_error !== true, output: snippet(toolResultText(block.content)) }]
          : [],
      );
    case "result":
      return [resultEvent(event)];
    default:
      return [];
  }
}

/** Cursor wraps each call as `{ readToolCall: { args, result } }` — the key is the tool. */
function cursorToolCall(toolCall: unknown): { name: string; payload: Json } {
  if (!isObject(toolCall)) return { name: "tool", payload: {} };
  const [key, payload] = Object.entries(toolCall)[0] ?? [];
  return {
    name: key ? key.replace(/ToolCall$/, "") : "tool",
    payload: isObject(payload) ? payload : {},
  };
}

function parseCursorEvent(event: Json): AgentRunEvent[] {
  switch (event.type) {
    case "system":
      return sessionEvent(event);
    case "assistant":
      return textBlocks(event.message);
    case "tool_call": {
      const { name, payload } = cursorToolCall(event.tool_call);
      if (event.subtype === "started") return [{ type: "tool_call", name, input: snippet(payload.args) }];
      if (event.subtype !== "completed") return [];
      const result = isObject(payload.result) ? payload.result : {};
      const ok = !("error" in result) && !("rejected" in result) && !("failure" in result);
      return [{ type: "tool_result", ok, output: snippet(result.success ?? result.error ?? result) }];
    }
    case "result":
      return [resultEvent(event)];
    default:
      return [];
  }
}

function parseCodexEvent(event: Json): AgentRunEvent[] {
  const sessionId = str(event.thread_id) ?? str(event.session_id);
  if ((event.type === "thread.started" || event.type === "session.created") && sessionId) {
    return [{ type: "session", sessionId }];
  }
  const item = isObject(event.item) ? event.item : null;
  if (event.type === "item.started" && item?.type === "command_execution") {
    return [{ type: "tool_call", name: "shell", input: snippet(item.command) }];
  }
  if (event.type === "item.completed" && item) {
    if (item.type === "agent_message" && typeof item.text === "string") {
      return [{ type: "text", text: clip(item.text, MAX_TEXT) }];
    }
    if (item.type === "command_execution") {
      return [{ type: "tool_result", ok: item.exit_code === 0, output: snippet(item.aggregated_output) }];
    }
    if (item.type === "file_change") return [{ type: "tool_call", name: "edit", input: snippet(item.changes) }];
  }
  if (event.type === "turn.failed" || event.type === "error") {
    const nested = isObject(event.error) ? str(event.error.message) : undefined;
    return [{ type: "error", message: nested ?? str(event.message) ?? "Codex reported an error" }];
  }
  return [];
}

/**
 * Parse one stdout line. Non-JSON lines from a JSON-speaking CLI (banners,
 * warnings) are kept as text rather than dropped — they are usually the reason
 * a run failed.
 */
export function parseStreamLine(format: AgentStreamFormat, line: string): AgentRunEvent[] {
  const plain = stripAnsi(line).replace(/\r$/, "");
  if (!plain.trim()) return [];
  if (format === "text" || !plain.trimStart().startsWith("{")) {
    return [{ type: "text", text: clip(plain, MAX_TEXT) }];
  }
  let event: unknown;
  try {
    event = JSON.parse(plain);
  } catch {
    return [{ type: "text", text: clip(plain, MAX_TEXT) }];
  }
  if (!isObject(event)) return [];
  if (format === "claude-stream-json") return parseClaudeEvent(event);
  if (format === "cursor-stream-json") return parseCursorEvent(event);
  return parseCodexEvent(event);
}

/** "12 turns · $0.0312 · 41.2s" — only the parts the CLI reported. */
export function describeResultStats(event: { costUsd?: number; turns?: number; durationMs?: number }): string {
  return [
    event.turns !== undefined ? `${event.turns} turns` : null,
    event.costUsd !== undefined ? `$${event.costUsd.toFixed(4)}` : null,
    event.durationMs !== undefined ? `${(event.durationMs / 1000).toFixed(1)}s` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const dim = (s: string) => `\x1b[90m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

/** Human-readable line for the DevHub terminal tab. */
export function renderAgentEvent(event: AgentRunEvent): string {
  switch (event.type) {
    case "session":
      return dim(`session ${event.sessionId}${event.model ? ` · ${event.model}` : ""}`);
    case "text":
      return event.text;
    case "tool_call":
      return cyan(`▸ ${event.name}${event.input ? ` ${event.input}` : ""}`);
    case "tool_result":
      return event.ok ? dim(`  ✓ ${event.output ?? ""}`) : red(`  ✗ ${event.output ?? "failed"}`);
    case "stderr":
      return dim(event.text);
    case "result": {
      const stats = describeResultStats(event);
      const label = event.ok ? green("── result") : red("── result (error)");
      return `${label}${stats ? dim(` · ${stats}`) : ""}`;
    }
    case "error":
      return red(`error: ${event.message}`);
  }
}

/** Plain-text line for UIs that aren't a terminal. */
export function describeAgentEvent(event: AgentRunEvent): string {
  switch (event.type) {
    case "session":
      return `session ${event.sessionId}${event.model ? ` · ${event.model}` : ""}`;
    case "text":
      return event.text;
    case "tool_call":
      return `→ ${event.name}${event.input ? ` ${event.input}` : ""}`;
    case "tool_result":
      return `  ${event.ok ? "ok" : "failed"}${event.output ? `: ${event.output}` : ""}`;
    case "stderr":
      return `stderr: ${event.text}`;
    case "result": {
      const stats = describeResultStats(event);
      return `result: ${event.ok ? "ok" : "error"}${stats ? ` · ${stats}` : ""}`;
    }
    case "error":
      return `error: ${event.message}`;
  }
}
