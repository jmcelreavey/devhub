import { describe, expect, it } from "vitest";
import { callerDepth, formatAgentEvent, formatRunSummary, type AgentRunSummary } from "./agents.ts";

const baseRun: AgentRunSummary = {
  id: "run-abc123-0011aabb",
  provider: "claude",
  providerLabel: "Claude Code",
  title: "Fix the flaky test",
  model: null,
  state: "queued",
  cwd: "/Users/me/Developer/app",
  worktree: null,
  parentRunId: null,
  createdAt: 1,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  eventCount: 0,
  sessionId: null,
  terminalSessionId: null,
  resultText: null,
  costUsd: null,
  turns: null,
  error: null,
};

describe("callerDepth", () => {
  it("reads DEVHUB_AGENT_DEPTH and treats junk as a top-level caller", () => {
    expect(callerDepth({ DEVHUB_AGENT_DEPTH: "2" })).toBe(2);
    expect(callerDepth({ DEVHUB_AGENT_DEPTH: "nope" })).toBe(0);
    expect(callerDepth({})).toBe(0);
  });
});

describe("formatRunSummary", () => {
  it("explains a queued run is waiting on the terminal dock", () => {
    expect(formatRunSummary(baseRun)).toContain("Waiting for the DevHub terminal dock");
  });

  it("shows stats and the result only once the run has finished", () => {
    const done = formatRunSummary({
      ...baseRun,
      state: "succeeded",
      turns: 4,
      costUsd: 0.0421,
      exitCode: 0,
      resultText: "Fixed it.",
    });
    expect(done).toContain("SUCCEEDED");
    expect(done).toContain("Stats: 4 turns · $0.0421 · exit 0");
    expect(done).toContain("Result:\nFixed it.");
    expect(formatRunSummary({ ...baseRun, state: "running", resultText: "partial" })).not.toContain("Result:");
  });
});

describe("formatAgentEvent", () => {
  it("prefixes the cursor and marks failed tool results", () => {
    expect(formatAgentEvent({ seq: 3, ts: 1, type: "tool_call", name: "Edit", input: "a.ts" })).toBe("[3] → Edit a.ts");
    expect(formatAgentEvent({ seq: 4, ts: 1, type: "tool_result", ok: false, output: "boom" })).toBe("[4]   FAILED: boom");
  });
});
