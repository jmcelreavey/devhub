import { expect, it, vi } from "vitest";
import { GET } from "./route";
import { getOpenCodeRecap, OpenCodeRecapError } from "../../../../lib/opencode/recap";

vi.mock("../../../../lib/api-utils", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../lib/api-utils")>(),
  requireDashboardAuth: (request: Request) => request.headers.has("x-fixture-auth")
    ? { ok: true }
    : { ok: false, response: new Response(null, { status: 401 }) },
}));
vi.mock("../../../../lib/opencode/recap", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../lib/opencode/recap")>(),
  getOpenCodeRecap: vi.fn(),
}));

it("keeps recap auth, query mapping and conflict status", async () => {
  const url = "http://localhost:1447/api/opencode/recap?sessionId=%20s1%20&children=true&directory=%20fixture%20";
  expect((await GET(new Request(url))).status).toBe(401);
  expect(getOpenCodeRecap).not.toHaveBeenCalled();

  vi.mocked(getOpenCodeRecap).mockResolvedValueOnce({ sessions: [] } as never);
  const request = () => new Request(url, { headers: { "x-fixture-auth": "yes" } });
  expect((await GET(request())).status).toBe(200);
  expect(getOpenCodeRecap).toHaveBeenCalledWith({ sessionId: "s1", includeChildren: true, directory: "fixture" });
  vi.mocked(getOpenCodeRecap).mockRejectedValueOnce(new OpenCodeRecapError(409, "Choose a session."));
  const conflict = await GET(request());
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ error: "Choose a session." });
});
