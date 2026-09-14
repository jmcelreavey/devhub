import { describe, expect, it } from "vitest";
import { describeResultStats, parseStreamLine } from "@/lib/agent-runs/events";

const line = (value: unknown) => JSON.stringify(value);

describe("parseStreamLine — claude", () => {
  it("maps init, text, tool use, tool result and result", () => {
    expect(
      parseStreamLine("claude-stream-json", line({ type: "system", subtype: "init", session_id: "s1", model: "haiku" })),
    ).toEqual([{ type: "session", sessionId: "s1", model: "haiku" }]);

    expect(
      parseStreamLine(
        "claude-stream-json",
        line({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Reading" },
              { type: "tool_use", name: "Read", input: { file_path: "a.txt" } },
            ],
          },
        }),
      ),
    ).toEqual([
      { type: "text", text: "Reading" },
      { type: "tool_call", name: "Read", input: '{"file_path":"a.txt"}' },
    ]);

    expect(
      parseStreamLine(
        "claude-stream-json",
        line({
          type: "user",
          message: { content: [{ type: "tool_result", content: [{ type: "text", text: "hello\nworld" }] }] },
        }),
      ),
    ).toEqual([{ type: "tool_result", ok: true, output: "hello world" }]);

    expect(
      parseStreamLine(
        "claude-stream-json",
        line({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "hello",
          total_cost_usd: 0.01,
          num_turns: 2,
          duration_ms: 1500,
        }),
      ),
    ).toEqual([{ type: "result", ok: true, text: "hello", costUsd: 0.01, turns: 2, durationMs: 1500 }]);
  });

  it("treats a non-success result subtype as a failure", () => {
    const [event] = parseStreamLine("claude-stream-json", line({ type: "result", subtype: "error_max_turns" }));
    expect(event).toMatchObject({ type: "result", ok: false });
  });
});

describe("parseStreamLine — cursor", () => {
  it("names tool calls by their wrapper key", () => {
    expect(
      parseStreamLine(
        "cursor-stream-json",
        line({ type: "tool_call", subtype: "started", tool_call: { readToolCall: { args: { path: "a.txt" } } } }),
      ),
    ).toEqual([{ type: "tool_call", name: "read", input: '{"path":"a.txt"}' }]);

    expect(
      parseStreamLine(
        "cursor-stream-json",
        line({
          type: "tool_call",
          subtype: "completed",
          tool_call: { shellToolCall: { result: { error: { message: "boom" } } } },
        }),
      ),
    ).toEqual([{ type: "tool_result", ok: false, output: '{"message":"boom"}' }]);
  });

  it("ignores the echoed user prompt", () => {
    expect(
      parseStreamLine("cursor-stream-json", line({ type: "user", message: { content: [{ type: "text", text: "hi" }] } })),
    ).toEqual([]);
  });
});

describe("parseStreamLine — codex", () => {
  it("maps thread, messages, commands and failures", () => {
    expect(parseStreamLine("codex-json", line({ type: "thread.started", thread_id: "t1" }))).toEqual([
      { type: "session", sessionId: "t1" },
    ]);
    expect(
      parseStreamLine("codex-json", line({ type: "item.completed", item: { type: "agent_message", text: "Done" } })),
    ).toEqual([{ type: "text", text: "Done" }]);
    expect(
      parseStreamLine(
        "codex-json",
        line({ type: "item.completed", item: { type: "command_execution", exit_code: 1, aggregated_output: "nope" } }),
      ),
    ).toEqual([{ type: "tool_result", ok: false, output: "nope" }]);
    expect(parseStreamLine("codex-json", line({ type: "turn.failed", error: { message: "rate limited" } }))).toEqual([
      { type: "error", message: "rate limited" },
    ]);
  });
});

describe("parseStreamLine — fallbacks", () => {
  it("strips ANSI from text-format output", () => {
    expect(parseStreamLine("text", "\x1b[32mdone\x1b[0m")).toEqual([{ type: "text", text: "done" }]);
  });

  it("keeps non-JSON lines from a JSON CLI as text", () => {
    expect(parseStreamLine("claude-stream-json", "Warning: config ignored")).toEqual([
      { type: "text", text: "Warning: config ignored" },
    ]);
  });

  it("drops blank lines", () => {
    expect(parseStreamLine("text", "   ")).toEqual([]);
  });
});

describe("describeResultStats", () => {
  it("includes only the stats the CLI reported", () => {
    expect(describeResultStats({ turns: 3, costUsd: 0.5, durationMs: 1234 })).toBe("3 turns · $0.5000 · 1.2s");
    expect(describeResultStats({})).toBe("");
  });
});
