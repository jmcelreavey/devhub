import { expect, it, vi } from "vitest";
import { POST } from "./route";
import { writeNow } from "../../../../../../lib/integrations/write-store";

vi.mock("../../../../../../lib/api-utils", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../../../lib/api-utils")>(),
  requireDashboardAuth: () => ({ ok: true }),
}));
vi.mock("../../../../../../domains/tasks/profiles", () => ({ getTaskProfileOverview: () => ({ active: "fixture" }) }));
vi.mock("../../../../../../lib/integrations/write-store", () => ({
  writeNow: vi.fn().mockResolvedValue({ result: { state: "succeeded", prepared: { details: {} } }, timings: { provider: 1 } }),
}));

it("denies cross-origin assignments and keeps the dashboard default", async () => {
  const params = { params: Promise.resolve({ key: "legacy-key" }) };
  const request = (origin: string) => new Request("http://localhost:1447/api/jira/ticket/legacy-key/assign", {
    method: "POST",
    headers: { origin, host: "localhost:1447", "content-type": "application/json" },
    body: "{}",
  });
  expect((await POST(request("https://other.example"), params)).status).toBe(403);
  expect(writeNow).not.toHaveBeenCalled();
  const response = await POST(request("http://localhost:1447"), params);
  expect(response.status).toBe(200);
  expect(response.headers.get("server-timing")).toBe("provider;dur=1");
  expect(vi.mocked(writeNow).mock.calls[0][0]).toMatchObject({ action: "issue.assign", assignee: "me", ref: { id: "legacy-key" } });
});
