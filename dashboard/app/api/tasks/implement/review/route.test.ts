import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchAgentRun: vi.fn(),
  readImplementReviewPrefs: vi.fn(),
  getTasks: vi.fn(),
}));

vi.mock("@/lib/api-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-utils")>()),
  requireDashboardAuth: () => ({ ok: true }),
}));
vi.mock("@/lib/agent-runs/dispatch", () => ({
  AgentDispatchError: class AgentDispatchError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
  dispatchAgentRun: mocks.dispatchAgentRun,
}));
vi.mock("@/lib/agent-runs/store", () => ({ toAgentRunSummary: (run: { id: string }) => ({ id: run.id, state: "running" }) }));
vi.mock("@/lib/tasks/implement-review-prefs", () => ({ readImplementReviewPrefs: mocks.readImplementReviewPrefs }));
vi.mock("@/lib/tasks/storage", () => ({ getTasks: mocks.getTasks, ensureTasksMigrated: async () => {} }));

import { AgentDispatchError } from "@/lib/agent-runs/dispatch";
import { POST } from "./route";

const valid = {
  taskId: "task-1",
  date: "2026-10-07",
  cwd: "/Users/dev/.devhub-worktrees/payments-api/pay-482",
  notePath: "pr-reviews/payments-api-pay-482",
  branch: "devhub/agent/pay-482",
  base: "origin/main",
  depth: 1,
};

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://127.0.0.1:1337/api/tasks/implement/review", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readImplementReviewPrefs.mockReturnValue({ provider: "codex", model: "gpt-6-astra" });
  mocks.getTasks.mockReturnValue([{ id: "task-1", text: "Cap webhook retries with jitter", jiraKey: "PAY-482" }]);
  mocks.dispatchAgentRun.mockResolvedValue({ id: "run-abc" });
});

describe("POST /api/tasks/implement/review", () => {
  it("starts the assigned reviewer read-only on the implementer's checkout", async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      run: { id: "run-abc" },
      reviewer: { provider: "codex", model: "gpt-6-astra" },
      notePath: "pr-reviews/payments-api-pay-482",
    });
    const dispatched = mocks.dispatchAgentRun.mock.calls[0][0];
    expect(dispatched).toMatchObject({
      provider: "codex",
      model: "gpt-6-astra",
      cwd: valid.cwd,
      worktree: false,
      depth: 1,
      reviewRun: true,
      activity: { source: "interactive", action: "review", notePath: valid.notePath },
    });
    expect(dispatched.activity).not.toHaveProperty("taskId");
    expect(dispatched.prompt).toContain("Cap webhook retries with jitter (PAY-482)");
    expect(dispatched.prompt).toContain("Implementation branch: devhub/agent/pay-482.");
  });

  it("uses the provider's default model when none is assigned", async () => {
    mocks.readImplementReviewPrefs.mockReturnValue({ provider: "claude", model: "" });
    const response = await POST(request(valid));
    expect((await response.json()).reviewer).toEqual({ provider: "claude", model: null });
    expect(mocks.dispatchAgentRun.mock.calls[0][0].model).toBeUndefined();
  });

  it("tells the agent to review its own diff when nobody is assigned", async () => {
    mocks.readImplementReviewPrefs.mockReturnValue({ provider: "", model: "" });
    const response = await POST(request(valid));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "no_reviewer" });
    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
  });

  it("refuses a review started from inside a review", async () => {
    const response = await POST(request({ ...valid, depth: 2 }));
    expect(response.status).toBe(409);
    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
  });

  it("404s an unknown task", async () => {
    mocks.getTasks.mockReturnValue([]);
    expect((await POST(request(valid))).status).toBe(404);
    expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
  });

  it.each(["notes/anything", "pr-reviews/../secrets", "pr-reviews/", "/pr-reviews/x", "pr-reviews//x", "pr-reviews/./x"])(
    "rejects the note path %s",
    async (notePath) => {
      expect((await POST(request({ ...valid, notePath }))).status).toBe(400);
      expect(mocks.dispatchAgentRun).not.toHaveBeenCalled();
    },
  );

  it("relays a dispatch refusal with its status", async () => {
    mocks.dispatchAgentRun.mockRejectedValue(new AgentDispatchError("Provider codex is not ready.", 400));
    const response = await POST(request(valid));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Provider codex is not ready." });
  });
});
