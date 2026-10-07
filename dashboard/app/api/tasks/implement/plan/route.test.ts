import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readImplementReviewPrefs: vi.fn() }));

vi.mock("@/lib/tasks/storage", () => ({
  getTasks: () => [{ id: "task-1", text: "Cap webhook retries", done: false, links: [{ kind: "repo", id: "acme/payments-api" }] }],
}));
vi.mock("@/lib/tasks/task-notes", () => ({ resolveTaskNotePath: () => "task-notes/2026-10-07-task-1" }));
vi.mock("@/lib/jira/client", () => ({ getTicket: async () => null }));
vi.mock("@/lib/entity-links/resolve", () => ({ resolveEntityContext: () => ({ notes: [], related: [], expanded: [] }) }));
vi.mock("@/lib/repos/resolution", () => ({ resolveLocalGithubRepos: async () => [] }));
vi.mock("@/lib/tasks/implement-repo", () => ({ selectTaskImplementationRepo: () => null }));
vi.mock("@/lib/tasks/plan-markdown", () => ({ buildPlanMarkdown: () => "" }));
vi.mock("@/lib/tasks/implement-review-prefs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/implement-review-prefs")>()),
  readImplementReviewPrefs: mocks.readImplementReviewPrefs,
}));

import { GET } from "./route";

const get = () =>
  GET(new NextRequest("http://127.0.0.1:1337/api/tasks/implement/plan?taskId=task-1&date=2026-10-07"));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/tasks/implement/plan reviewer", () => {
  it("is null when the implementing agent reviews its own diff", async () => {
    mocks.readImplementReviewPrefs.mockReturnValue({ provider: "", model: "" });
    expect((await (await get()).json()).reviewer).toBeNull();
  });

  it("names the assigned assistant and model", async () => {
    mocks.readImplementReviewPrefs.mockReturnValue({ provider: "codex", model: "gpt-6-astra" });
    expect((await (await get()).json()).reviewer).toEqual({ provider: "codex", model: "gpt-6-astra" });
  });

  it("reports a null model when the provider's default is assigned", async () => {
    mocks.readImplementReviewPrefs.mockReturnValue({ provider: "claude", model: "" });
    expect((await (await get()).json()).reviewer).toEqual({ provider: "claude", model: null });
  });
});
