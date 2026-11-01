import { expect, it, vi } from "vitest";
import { POST } from "./route";
import { writeNow } from "../../../../../../lib/integrations/write-store";
import { providerFor } from "../../../../../../lib/integrations/registry";

vi.mock("../../../../../../lib/api-utils", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../../../lib/api-utils")>(),
  requireDashboardAuth: () => ({ ok: true }),
}));
vi.mock("../../../../../../domains/tasks/profiles", () => ({ getTaskProfileOverview: () => ({ active: "fixture" }) }));
vi.mock("../../../../../../domains/tasks/ready-linked-prs", () => ({
  isCodeReviewStatus: () => false,
  taskIdsForJiraKey: () => [],
  queueReadyLinkedDraftPrs: vi.fn(),
}));
vi.mock("../../../../../../lib/integrations/registry", () => ({
  providerFor: vi.fn(() => ({ transitions: vi.fn().mockResolvedValue([{ id: "31", statusId: "2" }]) })),
}));
vi.mock("../../../../../../lib/integrations/write-store", () => ({
  writeNow: vi.fn().mockResolvedValue({ result: { state: "succeeded", prepared: { details: {} } }, timings: { provider: 1 } }),
}));

it("denies cross-origin writes and retains status-based undo", async () => {
  const params = { params: Promise.resolve({ key: "ABC-1" }) };
  const request = (origin: string) => new Request("http://localhost:1447/api/jira/ticket/ABC-1/transition", {
    method: "POST",
    headers: { origin, host: "localhost:1447", "content-type": "application/json" },
    body: JSON.stringify({ toStatusId: "2" }),
  });
  expect((await POST(request("https://other.example"), params)).status).toBe(403);
  expect(writeNow).not.toHaveBeenCalled();
  const response = await POST(request("http://localhost:1447"), params);
  expect(response.status).toBe(200);
  expect(response.headers.get("server-timing")).toBe("provider;dur=1");
  expect(providerFor).toHaveBeenCalledWith("jira");
  expect(vi.mocked(writeNow).mock.calls[0][0]).toMatchObject({ action: "issue.transition", transitionId: "31" });
});
