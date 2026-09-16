import { describe, expect, it } from "vitest";

/** Partial env for tests: NODE_ENV and friends are filled in loosely. */
const envOf = (vars: Record<string, string>): NodeJS.ProcessEnv => vars as unknown as NodeJS.ProcessEnv;
import { agentBudgets, costRefusalMessage, effectiveMaxTurns, spentToday } from "./budget";
import type { AgentRun } from "./store";
import type { AgentRunSpec, AgentRunStatus } from "./run-files";

function fakeRun(status: Partial<AgentRunStatus>): AgentRun {
  const spec: AgentRunSpec = {
    id: "run-x-00000000", provider: "claude", providerLabel: "Claude Code", bin: "/bin/x",
    args: [], format: "text", cwd: "/tmp", title: "t", prompt: "p", depth: 0, createdAt: 0,
  };
  return { spec, status: { state: "succeeded", updatedAt: 0, eventCount: 0, ...status }, dir: "/tmp/x" };
}

describe("agentBudgets", () => {
  it("defaults are on and conservative", () => {
    const b = agentBudgets(envOf({}));
    expect(b.maxTurns).toBe(200);
    expect(b.maxSeconds).toBe(1800);
    expect(b.maxCostUsd).toBe(25);
  });

  it("env overrides win, 0 disables", () => {
    const b = agentBudgets(envOf({ DEVHUB_AGENT_MAX_TURNS: "50", DEVHUB_AGENT_MAX_SECONDS: "0", DEVHUB_AGENT_MAX_COST_USD: "3" }));
    expect(b).toEqual({ maxTurns: 50, maxSeconds: 0, maxCostUsd: 3 });
  });

  it("junk env falls back", () => {
    expect(agentBudgets(envOf({ DEVHUB_AGENT_MAX_TURNS: "NaN" })).maxTurns).toBe(200);
    expect(agentBudgets(envOf({ DEVHUB_AGENT_MAX_TURNS: "-5" })).maxTurns).toBe(200);
  });
});

describe("effectiveMaxTurns", () => {
  it("caller choice wins over the budget", () => {
    expect(effectiveMaxTurns(7, { maxTurns: 200, maxSeconds: 0, maxCostUsd: 0 })).toBe(7);
  });

  it("applies the cap when the caller did not choose", () => {
    expect(effectiveMaxTurns(undefined, { maxTurns: 200, maxSeconds: 0, maxCostUsd: 0 })).toBe(200);
  });

  it("0 means uncapped", () => {
    expect(effectiveMaxTurns(undefined, { maxTurns: 0, maxSeconds: 0, maxCostUsd: 0 })).toBeUndefined();
  });
});

describe("spentToday", () => {
  it("sums finished runs from today only, ignoring running ones", () => {
    const now = new Date("2026-09-14T15:00:00").getTime();
    const todayMorning = new Date("2026-09-14T08:00:00").getTime();
    const yesterday = new Date("2026-09-13T20:00:00").getTime();
    const spent = spentToday(
      [
        fakeRun({ finishedAt: todayMorning, costUsd: 1.5 }),
        fakeRun({ finishedAt: now, costUsd: 2 }),
        fakeRun({ finishedAt: yesterday, costUsd: 100 }), // not today
        fakeRun({ costUsd: 50 }), // still running: no finishedAt
        fakeRun({ finishedAt: now }), // finished without cost
      ],
      now,
    );
    expect(spent).toBeCloseTo(3.5);
  });
});

describe("costRefusalMessage", () => {
  it("names the cap and the escape hatch", () => {
    expect(costRefusalMessage(25.3, 25)).toContain("$25.30");
    expect(costRefusalMessage(25.3, 25)).toContain("DEVHUB_AGENT_MAX_COST_USD");
  });
});
