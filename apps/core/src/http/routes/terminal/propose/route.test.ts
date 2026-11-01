import { expect, it } from "vitest";
import { GET, PATCH, POST } from "./route";

it("preserves dock confirmation and prevents an injection after denial", async () => {
  const request = (method: string, body: object) => new Request("http://localhost:1447/api/terminal/propose", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  expect((await POST(request("POST", { command: "  " }))).status).toBe(400);
  const created = await POST(request("POST", { command: " echo fixture ", source: "api" }));
  expect(created.status).toBe(201);
  const { proposal } = await created.json();
  expect(proposal).toMatchObject({ command: "echo fixture", status: "pending", autoRun: false });
  const denied = await PATCH(request("PATCH", { id: proposal.id, action: "deny" }));
  expect((await denied.json()).proposal.status).toBe("denied");
  const injection = await PATCH(request("PATCH", { id: proposal.id, action: "injected" }));
  expect((await injection.json()).proposal.status).toBe("denied");
  const fetched = await GET(new Request(`http://localhost:1447/api/terminal/propose?id=${proposal.id}`));
  expect((await fetched.json()).proposal.status).toBe("denied");
});
