import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeSlackUsage, recordSlackUsage, slackUsageTotals } from "./usage-log";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-usage-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("Slack usage log", () => {
  it("sums only today's entries and skips corrupt lines", () => {
    recordSlackUsage({ profile: "work", route: "rules", jevCalls: 0, jevCostUsd: 0, modelCalls: 0 }, root);
    recordSlackUsage({ profile: "work", route: "jev", tool: "a_one", jevCalls: 2, jevCostUsd: 0.0003, modelCalls: 1 }, root);
    recordSlackUsage({ profile: "work", route: "jev", jevCalls: 9, jevCostUsd: 9, modelCalls: 9, at: "2020-01-01T00:00:00.000Z" }, root);
    fs.appendFileSync(path.join(root, "usage.jsonl"), "not json\n{\"route\":\"nope\"}\n");
    expect(slackUsageTotals(root)).toMatchObject({ queries: 2, rules: 1, jevCalls: 2, modelCalls: 1 });
    expect(slackUsageTotals(root).jevCostUsd).toBeCloseTo(0.0003);
  });
  it("is empty without a file and never throws when the directory is unwritable", () => {
    expect(slackUsageTotals(path.join(root, "missing")).queries).toBe(0);
    expect(() => recordSlackUsage({ profile: "w", route: "rules", jevCalls: 0, jevCostUsd: 0, modelCalls: 0 }, path.join(root, "usage.jsonl", "x"))).not.toThrow();
    expect(describeSlackUsage(slackUsageTotals(root))).toBe("No questions today yet.");
  });
  it("describes totals in plain words", () => {
    expect(describeSlackUsage({ date: "d", queries: 1, rules: 1, jevCalls: 0, jevCostUsd: 0, modelCalls: 0 })).toBe("Today: 1 question · 1 answered by rules (free) · 0 Jev calls ≈ $0.0000 · no model calls");
  });
});
