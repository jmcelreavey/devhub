import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { DashboardClient, DashboardHttpError, type DashboardToolResult } from "../dashboard-client.ts";
import { freshMatches, prConditionMet, registerEventTools, type PrStateLike } from "./events.ts";

const base: PrStateLike = {
  state: "OPEN",
  reviewDecision: null,
  reviewCount: 0,
  latestReview: null,
  checks: { total: 3, pending: 2, passed: 1, failed: 0, skipped: 0 },
  failedChecks: [],
};

describe("prConditionMet", () => {
  it("checks_done waits for every check to leave pending, and not for a PR with no checks", () => {
    expect(prConditionMet("checks_done", base, base)).toBeNull();
    expect(
      prConditionMet("checks_done", base, {
        ...base,
        checks: { total: 3, pending: 0, passed: 2, failed: 1, skipped: 0 },
        failedChecks: ["e2e"],
      }),
    ).toBe("checks finished: 2 passed, 1 failed, 0 skipped, 0 pending (failed: e2e)");
    const none = { ...base, checks: { total: 0, pending: 0, passed: 0, failed: 0, skipped: 0 } };
    expect(prConditionMet("checks_done", none, none)).toBeNull();
  });

  it("review fires on a new review or a changed decision", () => {
    expect(prConditionMet("review", base, base)).toBeNull();
    expect(
      prConditionMet("review", base, { ...base, reviewCount: 1, latestReview: { author: "sam", state: "APPROVED" } }),
    ).toBe("new review from sam: APPROVED");
    expect(prConditionMet("review", base, { ...base, reviewDecision: "CHANGES_REQUESTED" })).toBe(
      "review decision is now CHANGES_REQUESTED",
    );
  });

  it("merged_or_closed and any_change compare against the baseline", () => {
    expect(prConditionMet("merged_or_closed", base, { ...base, state: "MERGED" })).toBe("PR merged");
    expect(prConditionMet("any_change", base, base)).toBeNull();
    expect(prConditionMet("any_change", base, { ...base, checks: { ...base.checks, pending: 1, passed: 2 } })).toContain(
      "PR changed",
    );
  });
});

describe("freshMatches", () => {
  it("returns unseen items whose title matches", () => {
    const items = [
      { id: "1", title: "API latency high" },
      { id: "2", title: "Disk full on db-1" },
      { id: "3", title: "API errors" },
    ];
    expect(freshMatches(items, new Set(["1"]), "api").map((i) => i.id)).toEqual(["3"]);
    expect(freshMatches(items, new Set(["1"])).map((i) => i.id)).toEqual(["2", "3"]);
  });
});

describe("Datadog event availability", () => {
  it.each([
    new DashboardHttpError(404, {}, "missing route"),
    new DashboardHttpError(503, { ok: false, code: "plugin_unavailable" }, "plugin disabled"),
  ])("explains when the plugin route is unavailable", async (error) => {
    const dashboard = new DashboardClient("http://localhost:1350");
    vi.spyOn(dashboard, "get").mockRejectedValue(error);
    let call: ((input: unknown, extra: unknown) => Promise<DashboardToolResult>) | undefined;
    const server = { registerTool: (_name: string, _config: unknown, handler: typeof call) => { call = handler; } };
    registerEventTools(server as unknown as McpServer, { dashboard } as Context);
    const result = await call!({ kind: "datadog_alert" }, { signal: new AbortController().signal });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Datadog plugin") });
  });

  it("preserves unrelated dashboard errors", async () => {
    const dashboard = new DashboardClient("http://localhost:1350");
    vi.spyOn(dashboard, "get").mockRejectedValue(new DashboardHttpError(503, { ok: false, code: "other" }, "maintenance"));
    let call: ((input: unknown, extra: unknown) => Promise<DashboardToolResult>) | undefined;
    const server = { registerTool: (_name: string, _config: unknown, handler: typeof call) => { call = handler; } };
    registerEventTools(server as unknown as McpServer, { dashboard } as Context);
    const result = await call!({ kind: "datadog_alert" }, { signal: new AbortController().signal });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: "maintenance" });
  });
});
