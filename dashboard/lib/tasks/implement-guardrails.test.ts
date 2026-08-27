import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MAX_CONCURRENT_AGENT_RUNS,
  checkImplementGuardrails,
  countBusyAgentRuns,
  describeAgentRunGuardrail,
} from "./implement-guardrails";

const busyAgent = { kind: "agent" as const, status: "open", busy: true };

function stubSessions(sessions: unknown[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions }) }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("countBusyAgentRuns", () => {
  it("counts only agent-like tabs that are open and mid-command", () => {
    expect(
      countBusyAgentRuns([
        busyAgent,
        { kind: "review", status: "open", busy: true },
        // Idle agent tab — the user can reuse it, so it must not block.
        { kind: "agent", status: "open", busy: false },
        // Closed tab lingering in the registry until the next prune.
        { kind: "agent", status: "closed", busy: true },
        // A busy shell is the user's own work, not an agent run.
        { kind: "shell", status: "open", busy: true },
      ]),
    ).toBe(2);
  });

  it("ignores rows with no kind rather than guessing from the label", () => {
    expect(countBusyAgentRuns([{ label: "claude implement", status: "open", busy: true }])).toBe(0);
  });
});

describe("describeAgentRunGuardrail", () => {
  it(`allows up to ${MAX_CONCURRENT_AGENT_RUNS - 1} concurrent runs`, () => {
    expect(describeAgentRunGuardrail(MAX_CONCURRENT_AGENT_RUNS - 1).blocked).toBe(false);
  });

  it("blocks at the cap and names the count", () => {
    const result = describeAgentRunGuardrail(MAX_CONCURRENT_AGENT_RUNS);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain(String(MAX_CONCURRENT_AGENT_RUNS));
  });
});

describe("checkImplementGuardrails", () => {
  it("blocks when the registry already has the cap in flight", async () => {
    stubSessions(Array.from({ length: MAX_CONCURRENT_AGENT_RUNS }, () => busyAgent));
    const result = await checkImplementGuardrails();
    expect(result.blocked).toBe(true);
    expect(result.runningCount).toBe(MAX_CONCURRENT_AGENT_RUNS);
  });

  it("lets the launch through when the dock is quiet", async () => {
    stubSessions([{ kind: "shell", status: "open", busy: true }]);
    await expect(checkImplementGuardrails()).resolves.toMatchObject({
      blocked: false,
      runningCount: 0,
    });
  });

  /** A guardrail that can't read the registry must not become a blocker. */
  it("fails open when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(checkImplementGuardrails()).resolves.toMatchObject({ blocked: false });
  });

  it("fails open on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await expect(checkImplementGuardrails()).resolves.toMatchObject({ blocked: false });
  });
});
