import { expect, it, vi } from "vitest";
import { POST } from "./route";
import { writeNow } from "../../../../lib/integrations/write-store";

vi.mock("../../../../lib/api-utils", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../lib/api-utils")>(),
  requireDashboardAuth: () => ({ ok: true }),
}));
vi.mock("../../../../domains/tasks/profiles", () => ({ getTaskProfileOverview: () => ({ active: "fixture" }) }));
vi.mock("../../../../lib/integrations/write-store", () => ({
  writeNow: vi.fn().mockResolvedValue({
    result: { state: "succeeded", receipt: { item: { ref: { id: "ABC-1" }, url: "https://jira.example/ABC-1" } } },
    timings: { provider: 1 },
  }),
}));

it("keeps strict origin checks and preserves untrimmed dashboard content", async () => {
  const request = (origin: string) => new Request("http://localhost:1447/api/jira/issue", {
    method: "POST",
    headers: { origin, host: "localhost:1447", "content-type": "application/json" },
    body: JSON.stringify({ projectKey: "ABC", summary: "  Example  ", description: "  Details  " }),
  });
  expect((await POST(request("https://other.example"))).status).toBe(403);
  expect(writeNow).not.toHaveBeenCalled();

  const response = await POST(request("http://localhost:1447"));
  expect(response.status).toBe(201);
  expect(response.headers.get("server-timing")).toBe("provider;dur=1");
  expect(writeNow).toHaveBeenCalledOnce();
  expect(vi.mocked(writeNow).mock.calls[0][0]).toMatchObject({ title: "  Example  ", body: "  Details  " });
});
